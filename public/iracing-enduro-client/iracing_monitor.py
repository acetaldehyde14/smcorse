import threading
import time
import irsdk
from config import POLL_INTERVAL_SECONDS

TELEM_HZ         = 10    # samples per second to collect
TELEM_BATCH_SIZE = 20    # send every 20 samples (~2s at 10Hz)


class IRacingMonitor:
    """
    Polls iRacing shared memory every POLL_INTERVAL_SECONDS.
    Fires on_event(event_type, data) for:
      - 'driver_change'  when the driver in the car changes
      - 'fuel_update'    every poll cycle with current fuel data
    """

    def __init__(self, on_event, on_status_change=None):
        self.ir = irsdk.IRSDK()
        self.on_event = on_event
        self.on_status_change = on_status_change  # callback(status_str)
        self._running = False
        self._thread = None
        self._telem_thread = None
        self._last_driver_name = None
        self._connected = False
        self._telem_buf = []      # pending samples
        self._telem_lock = threading.Lock()

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        self._telem_thread = threading.Thread(target=self._telem_loop, daemon=True)
        self._telem_thread.start()

    def stop(self):
        self._running = False

    def is_connected(self):
        return self._connected

    def _set_status(self, msg: str):
        print(f"[Monitor] {msg}")
        if self.on_status_change:
            self.on_status_change(msg)

    def _loop(self):
        self._set_status("Starting — waiting for iRacing...")
        while self._running:
            try:
                if not self.ir.is_initialized:
                    ok = self.ir.startup()
                    if not ok:
                        if self._connected:
                            self._connected = False
                            self._set_status("iRacing not detected. Waiting...")
                        time.sleep(5)
                        continue

                if not self.ir.is_connected:
                    if self._connected:
                        self._connected = False
                        self._set_status("iRacing closed. Waiting...")
                    time.sleep(5)
                    continue

                if not self._connected:
                    self._connected = True
                    self._set_status("Connected to iRacing ✓")

                self.ir.freeze_var_buffer_latest()
                self._read_data()

            except Exception as e:
                self._set_status(f"Error: {e}")
                time.sleep(5)
                # Reset SDK on error
                try:
                    self.ir.shutdown()
                except Exception:
                    pass

            time.sleep(POLL_INTERVAL_SECONDS)

    def _read_data(self):
        try:
            self._check_driver()
            self._check_fuel()
            self._check_position()
            self._collect_telem_sample()
        except Exception as e:
            print(f"[Monitor] Read error: {e}")

    def _collect_telem_sample(self):
        """Collect one high-frequency telemetry sample into the buffer."""
        try:
            t = self.ir["SessionTime"]
            if t is None:
                return

            def safe(key, idx=None):
                v = self.ir[key]
                if v is None:
                    return None
                return round(v[idx], 4) if idx is not None else round(v, 4) if isinstance(v, float) else v

            def avg3(arr):
                if not arr or len(arr) < 3:
                    return None
                return round(sum(arr[:3]) / 3, 1)

            sample = {
                "t":    round(t, 3),
                "spd":  safe("Speed"),
                "thr":  safe("Throttle"),
                "brk":  safe("Brake"),
                "steer": safe("SteeringWheelAngle"),
                "gear": self.ir["Gear"],
                "rpm":  round(self.ir["RPM"]) if self.ir["RPM"] else None,
                "ldp":  safe("LapDistPct"),
                # Tyre temps: inner/middle/outer per corner
                "tfl": avg3(self.ir["LFtempCL"] and [self.ir["LFtempCL"], self.ir["LFtempCM"], self.ir["LFtempCR"]]),
                "tfr": avg3(self.ir["RFtempCL"] and [self.ir["RFtempCL"], self.ir["RFtempCM"], self.ir["RFtempCR"]]),
                "trl": avg3(self.ir["LRtempCL"] and [self.ir["LRtempCL"], self.ir["LRtempCM"], self.ir["LRtempCR"]]),
                "trr": avg3(self.ir["RRtempCL"] and [self.ir["RRtempCL"], self.ir["RRtempCM"], self.ir["RRtempCR"]]),
                # Tyre wear (0=new, 1=worn)
                "wfl": safe("LFwearM"), "wfr": safe("RFwearM"),
                "wrl": safe("LRwearM"), "wrr": safe("RRwearM"),
                # G-forces
                "glat": safe("LatAccel"), "glon": safe("LongAccel"), "gver": safe("VertAccel"),
            }

            with self._telem_lock:
                self._telem_buf.append(sample)
        except Exception as e:
            print(f"[Monitor] Telem sample error: {e}")

    def _telem_loop(self):
        """Background thread: flushes the buffer to the server every BATCH_SIZE samples."""
        import api_client
        while self._running:
            time.sleep(1.0 / TELEM_HZ)
            with self._telem_lock:
                if len(self._telem_buf) >= TELEM_BATCH_SIZE:
                    batch = self._telem_buf[:TELEM_BATCH_SIZE]
                    self._telem_buf = self._telem_buf[TELEM_BATCH_SIZE:]
                else:
                    continue

            # Determine current lap from last sample
            lap = self.ir["Lap"] if self._connected else None
            threading.Thread(
                target=api_client.post_telemetry,
                args=(lap, batch),
                daemon=True,
            ).start()

    def _check_driver(self):
        try:
            # Get the driver currently in our team car
            # For multi-class, PlayerCarIdx tells us our car
            driver_idx = self.ir["PlayerCarIdx"]
            if driver_idx is None:
                return

            drivers = self.ir["DriverInfo"]["Drivers"]
            if not drivers:
                return

            current = next(
                (d for d in drivers if d.get("CarIdx") == driver_idx), None
            )
            if not current:
                return

            name = current.get("UserName", "").strip()
            user_id = str(current.get("UserID", ""))
            session_time = self.ir["SessionTime"] or 0

            if name and name != self._last_driver_name:
                old_driver = self._last_driver_name
                self._last_driver_name = name
                print(f"[Monitor] Driver change: {old_driver} → {name}")
                self.on_event("driver_change", {
                    "driver_name": name,
                    "driver_id": user_id,
                    "session_time": round(session_time, 2),
                })
        except Exception as e:
            print(f"[Monitor] Driver check error: {e}")

    def _check_fuel(self):
        try:
            fuel_level = self.ir["FuelLevel"]      # litres remaining
            fuel_pct = self.ir["FuelLevelPct"]     # 0.0–1.0
            fuel_use_per_hour = self.ir["FuelUsePerHour"]  # L/hour
            session_time = self.ir["SessionTime"] or 0

            if fuel_level is None:
                return

            # Calculate minutes of fuel remaining
            mins_remaining = None
            if fuel_use_per_hour and fuel_use_per_hour > 0.01:
                mins_remaining = round((fuel_level / fuel_use_per_hour) * 60, 1)

            self.on_event("fuel_update", {
                "fuel_level": round(fuel_level, 3),
                "fuel_pct": round(fuel_pct or 0, 4),
                "mins_remaining": mins_remaining,
                "session_time": round(session_time, 2),
            })
        except Exception as e:
            print(f"[Monitor] Fuel check error: {e}")

    def _check_position(self):
        try:
            player_idx = self.ir["PlayerCarIdx"]
            if player_idx is None:
                return

            positions       = self.ir["CarIdxPosition"]       # overall position per car (0 = not racing)
            class_positions = self.ir["CarIdxClassPosition"]   # class position per car
            f2_times        = self.ir["CarIdxF2Time"]          # seconds behind leader per car
            laps            = self.ir["CarIdxLap"]             # current lap per car
            last_laps       = self.ir["CarIdxLastLapTime"]     # last lap time per car
            best_laps       = self.ir["CarIdxBestLapTime"]     # best lap time per car
            session_time    = self.ir["SessionTime"] or 0

            if not positions or player_idx >= len(positions):
                return

            our_pos = positions[player_idx]
            if our_pos == 0:  # car not yet in race
                return

            our_f2        = f2_times[player_idx]        if f2_times   else None
            our_class_pos = class_positions[player_idx] if class_positions else None
            our_laps      = laps[player_idx]            if laps       else None
            our_last_lap  = last_laps[player_idx]       if last_laps  else None
            our_best_lap  = best_laps[player_idx]       if best_laps  else None

            # Build a position → car_idx lookup
            pos_to_idx = {}
            for idx, pos in enumerate(positions):
                if pos and pos > 0:
                    pos_to_idx[pos] = idx

            # Gaps to adjacent cars
            gap_ahead  = None
            gap_behind = None
            if our_f2 is not None and f2_times:
                ahead_idx = pos_to_idx.get(our_pos - 1)
                if ahead_idx is not None:
                    gap_ahead = round(our_f2 - f2_times[ahead_idx], 3)

                behind_idx = pos_to_idx.get(our_pos + 1)
                if behind_idx is not None:
                    gap_behind = round(f2_times[behind_idx] - our_f2, 3)

            # Resolve driver names
            driver_info = self.ir["DriverInfo"]
            all_drivers = driver_info.get("Drivers", []) if driver_info else []

            def get_name(idx):
                d = next((x for x in all_drivers if x.get("CarIdx") == idx), None)
                return d.get("UserName", "").strip() if d else f"Car {idx}"

            # Nearby cars: ±2 positions around us
            nearby = []
            for p in range(max(1, our_pos - 2), our_pos + 3):
                idx = pos_to_idx.get(p)
                if idx is None:
                    continue
                f2  = f2_times[idx] if f2_times and idx < len(f2_times) else None
                gap = round(f2 - our_f2, 3) if (f2 is not None and our_f2 is not None) else None
                ll  = last_laps[idx] if last_laps and idx < len(last_laps) else None
                nearby.append({
                    "position":    p,
                    "driver_name": get_name(idx),
                    "gap":         gap,   # negative = ahead of us, positive = behind
                    "is_us":       idx == player_idx,
                    "laps":        laps[idx] if laps and idx < len(laps) else None,
                    "last_lap":    round(ll, 3) if ll and ll > 0 else None,
                })

            self.on_event("position_update", {
                "position":       our_pos,
                "class_position": our_class_pos,
                "gap_to_leader":  round(our_f2, 3) if our_f2 is not None else None,
                "gap_ahead":      gap_ahead,
                "gap_behind":     gap_behind,
                "laps_completed": our_laps,
                "last_lap_time":  round(our_last_lap, 3) if our_last_lap and our_last_lap > 0 else None,
                "best_lap_time":  round(our_best_lap, 3) if our_best_lap and our_best_lap > 0 else None,
                "nearby_cars":    nearby,
                "session_time":   round(session_time, 2),
            })
        except Exception as e:
            print(f"[Monitor] Position check error: {e}")
