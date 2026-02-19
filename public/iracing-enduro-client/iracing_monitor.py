import threading
import time
import irsdk
from config import POLL_INTERVAL_SECONDS


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
        self._last_driver_name = None
        self._connected = False

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

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
        except Exception as e:
            print(f"[Monitor] Read error: {e}")

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
