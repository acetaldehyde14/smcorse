"use strict";
(() => {
  // public/ts/shared/auth.ts
  function getHeaders() {
    const tok = localStorage.getItem("jwtToken");
    const h = { "Content-Type": "application/json" };
    if (tok) h["Authorization"] = "Bearer " + tok;
    return h;
  }
  async function apiFetch(url) {
    const res = await fetch(url, { headers: getHeaders(), credentials: "include" });
    if (res.status === 401) {
      window.location.href = "/";
      throw new Error("auth");
    }
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  // public/ts/shared/utils.ts
  function fmtTime(s) {
    if (!s || s <= 0) return "\u2014";
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toFixed(3).padStart(6, "0")}`;
  }

  // public/ts/lap-analysis.ts
  var allLaps = [];
  var filteredLaps = [];
  var lapA = null;
  var lapB = null;
  var telA = null;
  var telB = null;
  var activeTab = "a";
  var zoomStart = 0;
  var zoomEnd = 1;
  var cursorPct = null;
  var dragAnchorPct = null;
  var dragMoved = false;
  async function init() {
    try {
      const data = await apiFetch("/api/telemetry/all-laps");
      allLaps = (data.laps || []).sort(
        (a, b) => (a.track_name || "").localeCompare(b.track_name || "") || (a.lap_time || 0) - (b.lap_time || 0)
      );
      filteredLaps = allLaps;
      renderList();
    } catch (e) {
      if (e.message !== "auth")
        document.getElementById("lapList").innerHTML = '<div style="padding:12px 10px;color:#aa3333;font-size:.72rem">Failed to load laps</div>';
    }
  }
  function normFrames(raw) {
    return raw.map((f) => ({
      pct: f.lap_dist_pct != null ? +f.lap_dist_pct : f.LapDistPct != null ? +f.LapDistPct : null,
      speed: f.speed_kph != null ? +f.speed_kph : f.Speed != null ? +f.Speed * 3.6 : null,
      thr: f.throttle != null ? +f.throttle : f.Throttle != null ? +f.Throttle : null,
      brk: f.brake != null ? +f.brake : f.Brake != null ? +f.Brake : null,
      steer: f.steering_deg != null ? +f.steering_deg : f.SteeringWheelAngle != null ? +f.SteeringWheelAngle * (180 / Math.PI) : null,
      gear: f.gear != null ? +f.gear : f.Gear != null ? +f.Gear : null,
      rpm: f.rpm != null ? +f.rpm : f.RPM != null ? +f.RPM : null,
      x: f.x_pos != null ? +f.x_pos : null,
      y: f.y_pos != null ? +f.y_pos : null,
      t: f.session_time != null ? +f.session_time : null,
      yaw: f.yaw_rate != null ? +f.yaw_rate : null
    })).filter((f) => f.pct != null && f.pct >= 0 && f.pct <= 1.001);
  }
  function buildXYFromYaw(frames) {
    const hasYaw = frames.some((f) => f.yaw != null);
    if (!hasYaw) return frames;
    let x = 0, y = 0, heading = Math.PI / 2;
    return frames.map((f, i) => {
      if (i > 0) {
        const prev = frames[i - 1];
        const dt = f.t != null && prev.t != null ? f.t - prev.t : 0.1;
        const spd = (f.speed || 0) / 3.6;
        heading += (f.yaw || 0) * dt;
        x += spd * Math.cos(heading) * dt;
        y += spd * Math.sin(heading) * dt;
      }
      return { ...f, x, y };
    });
  }
  function lerp(a, b, t) {
    if (a == null || b == null) return a ?? b;
    return a + (b - a) * t;
  }
  function interp(frames, pct) {
    if (!frames || !frames.length) return null;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi - 1) {
      const mid = lo + hi >> 1;
      if (frames[mid].pct <= pct) lo = mid;
      else hi = mid;
    }
    const f = frames[lo], g = frames[hi];
    if (!f) return null;
    if (!g || f.pct === g.pct) return f;
    const t = (pct - f.pct) / (g.pct - f.pct);
    return {
      pct,
      speed: lerp(f.speed, g.speed, t),
      thr: lerp(f.thr, g.thr, t),
      brk: lerp(f.brk, g.brk, t),
      steer: lerp(f.steer, g.steer, t),
      gear: f.gear,
      rpm: lerp(f.rpm, g.rpm, t),
      x: lerp(f.x, g.x, t),
      y: lerp(f.y, g.y, t)
    };
  }
  function filterLaps(q) {
    const lq = q.toLowerCase();
    filteredLaps = q ? allLaps.filter((l) => (l.track_name || "").toLowerCase().includes(lq) || (l.car_name || "").toLowerCase().includes(lq)) : allLaps;
    renderList();
  }
  function renderList() {
    const el = document.getElementById("lapList");
    if (!filteredLaps.length) {
      el.innerHTML = '<div style="padding:12px 10px;color:#2a3550;font-size:.72rem">No laps found</div>';
      return;
    }
    el.innerHTML = filteredLaps.map((lap) => {
      const isA = lapA?.id === lap.id, isB = lapB?.id === lap.id;
      const badge = isA ? `<span class="lbadge ba">A</span><span class="lx" onclick="clearLap('a');event.stopPropagation()">\xD7</span>` : isB ? `<span class="lbadge bb">B</span><span class="lx" onclick="clearLap('b');event.stopPropagation()">\xD7</span>` : "";
      return `<div class="li${isA ? " la" : isB ? " lb" : ""}" onclick="clickLap(${lap.id})">
      ${badge}
      <div class="lt">${lap.track_name || "\u2014"}</div>
      <div class="lc">${lap.car_name || ""}</div>
      <div class="lv">${fmtTime(lap.lap_time)}</div>
    </div>`;
    }).join("");
  }
  function setTab(t) {
    activeTab = t;
    document.getElementById("tabA").className = "ltab" + (t === "a" ? " act-a" : "");
    document.getElementById("tabB").className = "ltab" + (t === "b" ? " act-b" : "");
  }
  async function clickLap(id) {
    const meta = allLaps.find((l) => l.id === id);
    if (!meta) return;
    if (activeTab === "a") {
      lapA = meta;
      telA = null;
    } else {
      lapB = meta;
      telB = null;
    }
    updateHeader();
    renderList();
    document.getElementById("emptyHint").style.display = "none";
    document.getElementById("mapEmpty").style.display = "none";
    const tel = await loadTel(id);
    if (activeTab === "a") {
      telA = tel;
      if (!lapB) setTab("b");
    } else {
      telB = tel;
    }
    updateStats();
    drawAll();
  }
  async function loadTel(id) {
    try {
      const data = await apiFetch(`/api/telemetry/laps/${id}/telemetry`);
      return normFrames(Array.isArray(data.telemetry) ? data.telemetry : []);
    } catch {
      return [];
    }
  }
  function updateHeader() {
    const lap = lapA || lapB;
    document.getElementById("topTrack").textContent = lap?.track_name || "\u2014";
    document.getElementById("topCar").textContent = lap?.car_name || "";
    const tabA = document.getElementById("tabA");
    const tabB = document.getElementById("tabB");
    if (lapA) {
      tabA.classList.add("has-lap");
      document.getElementById("selATime").textContent = fmtTime(lapA.lap_time);
    } else {
      tabA.classList.remove("has-lap");
    }
    if (lapB) {
      tabB.classList.add("has-lap");
      document.getElementById("selBTime").textContent = fmtTime(lapB.lap_time);
    } else {
      tabB.classList.remove("has-lap");
    }
  }
  function clearLap(side) {
    if (side === "a") {
      lapA = null;
      telA = null;
    } else {
      lapB = null;
      telB = null;
    }
    updateHeader();
    renderList();
    updateStats();
    drawAll();
    if (!lapA && !lapB) {
      document.getElementById("emptyHint").style.display = "flex";
      document.getElementById("mapEmpty").style.display = "flex";
      document.getElementById("mapEmpty").textContent = "Select a lap";
    }
  }
  function updateStats() {
    const tel = telA || telB;
    const lap = lapA || lapB;
    if (!tel || !tel.length) {
      ["sv0", "sv1", "sv2", "sv3", "sv4", "sv5", "sv6", "sv7"].forEach((id) => document.getElementById(id).textContent = "\u2014");
      return;
    }
    const speeds = tel.map((f) => f.speed).filter((v) => v != null);
    const rpms = tel.map((f) => f.rpm).filter((v) => v != null);
    const thrs = tel.map((f) => f.thr).filter((v) => v != null);
    const maxSpd = speeds.length ? Math.max(...speeds) : 0;
    const avgSpd = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
    const maxRpm = rpms.length ? Math.max(...rpms) : 0;
    const fullThr = thrs.length ? thrs.filter((t) => t > 0.95).length / thrs.length * 100 : 0;
    let brakeZones = 0, inBrk = false;
    for (const f of tel) {
      if ((f.brk || 0) > 0.1) {
        if (!inBrk) {
          brakeZones++;
          inBrk = true;
        }
      } else inBrk = false;
    }
    let lifts = 0, inLift = false;
    for (const f of tel) {
      const lifting = (f.thr || 0) < 0.5 && (f.brk || 0) < 0.05;
      if (lifting) {
        if (!inLift) {
          lifts++;
          inLift = true;
        }
      } else inLift = false;
    }
    document.getElementById("sv0").textContent = fullThr.toFixed(1) + "%";
    document.getElementById("sv1").textContent = maxSpd.toFixed(0);
    document.getElementById("sv2").textContent = avgSpd.toFixed(0);
    document.getElementById("sv3").textContent = brakeZones;
    document.getElementById("sv4").textContent = lifts;
    document.getElementById("sv5").textContent = "\u2014";
    document.getElementById("sv6").textContent = maxRpm > 0 ? maxRpm.toFixed(0) : "\u2014";
    document.getElementById("sv7").textContent = fmtTime(lap?.lap_time);
  }
  function sizeCanvas(canvas, panelEl) {
    const dpr = window.devicePixelRatio || 1;
    const rect = (panelEl || canvas.parentElement).getBoundingClientRect();
    const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { ctx: canvas.getContext("2d"), w, h, dpr };
  }
  function pctX(pct, w) {
    return (pct - zoomStart) / (zoomEnd - zoomStart) * w;
  }
  function drawCursor(ctx, w, h, dpr, x) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.strokeStyle = "rgba(255,255,255,.22)";
    ctx.lineWidth = dpr;
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  function drawMap() {
    const { ctx, w, h, dpr } = sizeCanvas(document.getElementById("cvMap"), document.getElementById("mapPanel"));
    ctx.clearRect(0, 0, w, h);
    const frames = telA || telB;
    if (!frames || !frames.length) return;
    let fxy = frames.filter((f) => f.x != null && f.y != null);
    if (!fxy.length) {
      const built = buildXYFromYaw(frames);
      fxy = built.filter((f) => f.x != null && f.y != null);
    }
    if (!fxy.length) {
      document.getElementById("mapEmpty").style.display = "flex";
      document.getElementById("mapEmpty").textContent = "No position data";
      return;
    }
    document.getElementById("mapEmpty").style.display = "none";
    const xs = fxy.map((f) => f.x), ys = fxy.map((f) => f.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const rX = maxX - minX || 1, rY = maxY - minY || 1;
    const pad = 0.09;
    const scale = Math.min(w * (1 - 2 * pad) / rX, h * (1 - 2 * pad) / rY);
    const offX = (w - rX * scale) / 2 - minX * scale;
    const offY = (h + rY * scale) / 2 + minY * scale;
    const toX = (x) => x * scale + offX;
    const toY = (y) => -y * scale + offY;
    ctx.beginPath();
    let mv = true;
    for (const f of fxy) {
      if (mv) {
        ctx.moveTo(toX(f.x), toY(f.y));
        mv = false;
      } else ctx.lineTo(toX(f.x), toY(f.y));
    }
    ctx.strokeStyle = "rgba(255,255,255,.09)";
    ctx.lineWidth = 5 * dpr;
    ctx.lineJoin = "round";
    ctx.stroke();
    for (let i = 1; i < fxy.length; i++) {
      const f = fxy[i], p = fxy[i - 1];
      const t = f.thr || 0, b = f.brk || 0;
      ctx.beginPath();
      ctx.moveTo(toX(p.x), toY(p.y));
      ctx.lineTo(toX(f.x), toY(f.y));
      ctx.strokeStyle = b > 0.05 ? `rgba(255,51,68,${Math.min(0.95, 0.35 + b * 0.7)})` : t > 0.7 ? `rgba(0,220,80,${Math.min(0.9, 0.35 + t * 0.5)})` : "rgba(255,193,7,.45)";
      ctx.lineWidth = 2.5 * dpr;
      ctx.stroke();
    }
    if (cursorPct != null) {
      const f = interp(telA || telB, cursorPct);
      if (f && f.x != null) {
        ctx.beginPath();
        ctx.arc(toX(f.x), toY(f.y), 4 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
      }
      if (f?.gear != null) {
        document.getElementById("gearOv").textContent = f.gear;
        document.getElementById("sv5").textContent = f.gear;
      }
    }
  }
  function drawSpeed() {
    const { ctx, w, h, dpr } = sizeCanvas(document.getElementById("cvSpeed"));
    ctx.clearRect(0, 0, w, h);
    const maxS = Math.max(...(telA || []).map((f) => f.speed || 0), ...(telB || []).map((f) => f.speed || 0), 100);
    const ceil = Math.ceil(maxS / 50) * 50;
    const toY = (v) => h - v / ceil * h;
    const draw = (frames, color, fill) => {
      if (!frames || !frames.length) return;
      const vis = frames.filter((f) => f.pct >= zoomStart - 5e-3 && f.pct <= zoomEnd + 5e-3);
      if (vis.length < 2) return;
      ctx.beginPath();
      let mv = true;
      for (const f of vis) {
        if (f.speed == null) {
          mv = true;
          continue;
        }
        const x = pctX(f.pct, w), y = toY(f.speed);
        if (mv) {
          ctx.moveTo(x, y);
          mv = false;
        } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * dpr;
      ctx.lineJoin = "round";
      ctx.stroke();
      if (fill) {
        ctx.lineTo(pctX(vis[vis.length - 1].pct, w), h);
        ctx.lineTo(pctX(vis[0].pct, w), h);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }
    };
    draw(telA, "#2196f3", "rgba(33,150,243,.1)");
    draw(telB, "#ff9800", "rgba(255,152,0,.08)");
    if (cursorPct != null && cursorPct >= zoomStart && cursorPct <= zoomEnd) {
      drawCursor(ctx, w, h, dpr, pctX(cursorPct, w));
      const f = interp(telA, cursorPct) || interp(telB, cursorPct);
      if (f?.speed != null) document.getElementById("vSpeed").textContent = `kph ${f.speed.toFixed(0)}`;
    }
  }
  function drawTB() {
    const { ctx, w, h, dpr } = sizeCanvas(document.getElementById("cvTB"));
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    const drawCh = (frames, getter, base, scaleH, line, fill) => {
      if (!frames || !frames.length) return;
      const vis = frames.filter((f) => f.pct >= zoomStart - 5e-3 && f.pct <= zoomEnd + 5e-3);
      if (!vis.length) return;
      ctx.beginPath();
      ctx.moveTo(pctX(vis[0].pct, w), base);
      for (const f of vis) ctx.lineTo(pctX(f.pct, w), base - (getter(f) || 0) * scaleH);
      ctx.lineTo(pctX(vis[vis.length - 1].pct, w), base);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.beginPath();
      let mv = true;
      for (const f of vis) {
        const x = pctX(f.pct, w), y = base - (getter(f) || 0) * scaleH;
        if (mv) {
          ctx.moveTo(x, y);
          mv = false;
        } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = line;
      ctx.lineWidth = dpr;
      ctx.stroke();
    };
    drawCh(telA, (f) => f.thr, mid, mid * 0.96, "#00cc55", "rgba(0,204,85,.3)");
    drawCh(telA, (f) => f.brk, mid, mid * 0.96, "#ff3344", "rgba(255,51,68,.35)");
    drawCh(telB, (f) => f.thr, mid, mid * 0.96, "rgba(255,152,0,.7)", "rgba(255,152,0,.12)");
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.strokeStyle = "rgba(255,255,255,.05)";
    ctx.lineWidth = dpr;
    ctx.stroke();
    if (cursorPct != null && cursorPct >= zoomStart && cursorPct <= zoomEnd) {
      drawCursor(ctx, w, h, dpr, pctX(cursorPct, w));
      const f = interp(telA, cursorPct) || interp(telB, cursorPct);
      if (f) document.getElementById("vTB").textContent = `Thr ${(f.thr || 0).toFixed(2)}  Brk ${(f.brk || 0).toFixed(2)}`;
    }
  }
  function drawSteer() {
    const { ctx, w, h, dpr } = sizeCanvas(document.getElementById("cvSteer"));
    ctx.clearRect(0, 0, w, h);
    const maxS = Math.max(
      ...(telA || []).map((f) => Math.abs(f.steer || 0)),
      ...(telB || []).map((f) => Math.abs(f.steer || 0)),
      30
    );
    const toY = (v) => h / 2 - v / maxS * (h / 2);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.strokeStyle = "rgba(255,255,255,.05)";
    ctx.lineWidth = dpr;
    ctx.stroke();
    const draw = (frames, color) => {
      if (!frames || !frames.length) return;
      const vis = frames.filter((f) => f.pct >= zoomStart - 5e-3 && f.pct <= zoomEnd + 5e-3);
      if (vis.length < 2) return;
      ctx.beginPath();
      let mv = true;
      for (const f of vis) {
        if (f.steer == null) {
          mv = true;
          continue;
        }
        const x = pctX(f.pct, w), y = toY(f.steer);
        if (mv) {
          ctx.moveTo(x, y);
          mv = false;
        } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * dpr;
      ctx.lineJoin = "round";
      ctx.stroke();
    };
    draw(telA, "#ffc107");
    draw(telB, "rgba(255,152,0,.5)");
    if (cursorPct != null && cursorPct >= zoomStart && cursorPct <= zoomEnd) {
      drawCursor(ctx, w, h, dpr, pctX(cursorPct, w));
      const f = interp(telA, cursorPct) || interp(telB, cursorPct);
      if (f?.steer != null) document.getElementById("vSteer").textContent = `${f.steer.toFixed(1)}\xB0`;
    }
  }
  function drawRPM() {
    const { ctx, w, h, dpr } = sizeCanvas(document.getElementById("cvRPM"));
    ctx.clearRect(0, 0, w, h);
    const maxR = Math.max(...(telA || []).map((f) => f.rpm || 0), ...(telB || []).map((f) => f.rpm || 0), 1e3);
    const toY = (v) => h - v / maxR * h;
    const draw = (frames, color, fill) => {
      if (!frames || !frames.length) return;
      const vis = frames.filter((f) => f.pct >= zoomStart - 5e-3 && f.pct <= zoomEnd + 5e-3);
      if (vis.length < 2) return;
      ctx.beginPath();
      let mv = true;
      for (const f of vis) {
        if (f.rpm == null) {
          mv = true;
          continue;
        }
        const x = pctX(f.pct, w), y = toY(f.rpm);
        if (mv) {
          ctx.moveTo(x, y);
          mv = false;
        } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * dpr;
      ctx.lineJoin = "round";
      ctx.stroke();
      if (fill) {
        ctx.lineTo(pctX(vis[vis.length - 1].pct, w), h);
        ctx.lineTo(pctX(vis[0].pct, w), h);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }
    };
    draw(telA, "#aa88ff", "rgba(170,136,255,.1)");
    draw(telB, "rgba(255,152,0,.5)", null);
    if (cursorPct != null && cursorPct >= zoomStart && cursorPct <= zoomEnd) {
      drawCursor(ctx, w, h, dpr, pctX(cursorPct, w));
      const f = interp(telA, cursorPct) || interp(telB, cursorPct);
      if (f?.rpm != null)
        document.getElementById("vRPM").textContent = `RPM ${f.rpm.toFixed(0)}${f.gear != null ? " Gear " + f.gear : ""}`;
    }
  }
  function drawAll() {
    drawMap();
    drawSpeed();
    drawTB();
    drawSteer();
    drawRPM();
  }
  var tracesEl = document.getElementById("traces");
  function pctFromMouseX(clientX) {
    const r = tracesEl.getBoundingClientRect();
    const raw = zoomStart + (clientX - r.left) / r.width * (zoomEnd - zoomStart);
    return Math.max(zoomStart, Math.min(zoomEnd, raw));
  }
  tracesEl.addEventListener("mousemove", (e) => {
    cursorPct = pctFromMouseX(e.clientX);
    drawAll();
  });
  tracesEl.addEventListener("mouseleave", () => {
    cursorPct = null;
    drawAll();
  });
  tracesEl.addEventListener("mousedown", (e) => {
    dragAnchorPct = pctFromMouseX(e.clientX);
    dragMoved = false;
    e.preventDefault();
  });
  tracesEl.addEventListener("mousemove", (e) => {
    if (dragAnchorPct == null) return;
    if (Math.abs(pctFromMouseX(e.clientX) - dragAnchorPct) > 5e-3) dragMoved = true;
  });
  tracesEl.addEventListener("mouseup", (e) => {
    if (dragAnchorPct == null) return;
    if (dragMoved) {
      const endPct = pctFromMouseX(e.clientX);
      const lo = Math.max(0, Math.min(dragAnchorPct, endPct));
      const hi = Math.min(1, Math.max(dragAnchorPct, endPct));
      if (hi - lo > 0.01) {
        zoomStart = lo;
        zoomEnd = hi;
        drawAll();
      }
    }
    dragAnchorPct = null;
    dragMoved = false;
  });
  tracesEl.addEventListener("dblclick", () => {
    zoomStart = 0;
    zoomEnd = 1;
    drawAll();
  });
  var ro = new ResizeObserver(() => drawAll());
  ro.observe(document.getElementById("mapPanel"));
  ro.observe(tracesEl);
  init();
  window.clickLap = clickLap;
  window.clearLap = clearLap;
  window.setTab = setTab;
  window.filterLaps = filterLaps;
})();
