const fs = require('fs').promises;
const path = require('path');

/**
 * iRacing Telemetry Parser
 * Parses .ibt (iRacing Binary Telemetry) files
 *
 * IBT File Structure:
 * - Header (0x00-0x6F): Version, tick rate, offsets to session info and variable headers
 * - Variable Headers (at VarHeaderOffset): 144 bytes each, describe telemetry channels
 * - Session Info (at SessionInfoOffset): YAML text with track, car, driver info
 * - Data Records (at DataOffset): Fixed-size records at TickRate Hz
 */

class TelemetryParser {

  /**
   * Parse any telemetry file type
   */
  async parseFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    switch (ext) {
      case '.ibt':
        return await this.parseIBT(filePath);
      case '.blap':
      case '.olap':
        return await this.parseLapFile(filePath, ext);
      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  /**
   * Parse IBT (iRacing Binary Telemetry) file
   */
  async parseIBT(filePath) {
    const buffer = await fs.readFile(filePath);

    // Parse binary header
    const header = this.parseIBTHeader(buffer);

    // Parse session info YAML
    const sessionInfo = this.parseSessionInfo(buffer, header);

    // Parse variable headers to find telemetry channel offsets
    const varHeaders = this.parseVarHeaders(buffer, header);

    // Extract lap times from telemetry data
    const laps = this.extractLaps(buffer, header, varHeaders);

    // Extract telemetry samples (downsampled for storage)
    const telemetry = this.extractTelemetry(buffer, header, varHeaders);

    return {
      type: 'ibt',
      header,
      sessionInfo,
      laps,
      telemetry,
      metadata: {
        track: sessionInfo.trackDisplayName || sessionInfo.trackName,
        trackShort: sessionInfo.trackShortName,
        trackConfig: sessionInfo.trackConfig,
        trackLength: sessionInfo.trackLength,
        car: sessionInfo.carName,
        carPath: sessionInfo.carPath,
        sessionType: sessionInfo.sessionType,
        lapTime: laps.bestLapTime || 0,
        lapTimes: laps.lapTimes,
        sectorTimes: [],
        tickRate: header.tickRate,
        totalRecords: header.totalRecords,
        duration: header.totalRecords / header.tickRate,
        fileName: path.basename(filePath),
        fileSize: buffer.length,
        parsedAt: new Date().toISOString()
      }
    };
  }

  /**
   * Parse .blap/.olap files
   * BLAP (Best Lap) format stores single-lap telemetry data.
   *
   * BLAP Header Structure:
   * 0x00: char[4] magic "BLAP"
   * 0x04: int32 version (3)
   * 0x08: int32 unknown
   * 0x0C: int32 iRacingCustomerId
   * 0x10: char[124] driverName
   * 0x8C: int32 carId
   * 0x90: char[64] carPath (e.g. "porsche992rgt3")
   * ...
   * ~0x53E: char[] trackPath (e.g. "spa\up")
   * ~0x5B4: float lapTime (seconds)
   */
  async parseLapFile(filePath, ext) {
    const fileName = path.basename(filePath);
    const stat = await fs.stat(filePath);
    const carInfo = this.extractInfoFromFilename(fileName);

    try {
      const fd = await fs.open(filePath, 'r');
      const headerSize = Math.min(65536, stat.size);
      const headerBuf = Buffer.alloc(headerSize);
      await fd.read(headerBuf, 0, headerBuf.length, 0);
      await fd.close();

      // Check for BLAP magic
      const magic = headerBuf.slice(0, 4).toString('ascii');
      if (magic === 'BLAP') {
        return this.parseBLAP(headerBuf, fileName, stat.size, ext);
      }

      // Check if this file has an IBT-like header (version 2, valid tick rate)
      const version = headerBuf.readInt32LE(0);
      const tickRate = headerBuf.readInt32LE(8);

      if (version === 2 && tickRate > 0 && tickRate <= 360) {
        const sessionInfoLen = headerBuf.readInt32LE(0x10);
        const sessionInfoOffset = headerBuf.readInt32LE(0x14);

        if (sessionInfoOffset > 0 && sessionInfoOffset < stat.size &&
            sessionInfoLen > 0 && sessionInfoLen < 500000) {
          const siBuf = Buffer.alloc(sessionInfoLen);
          const fd2 = await fs.open(filePath, 'r');
          await fd2.read(siBuf, 0, sessionInfoLen, sessionInfoOffset);
          await fd2.close();

          const yamlText = siBuf.toString('ascii');
          const getValue = (key) => {
            const regex = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm');
            const match = yamlText.match(regex);
            return match ? match[1].trim() : null;
          };

          const trackDisplayName = getValue('TrackDisplayName');
          const carScreenName = getValue('CarScreenName');

          if (trackDisplayName || carScreenName) {
            return {
              type: ext.replace('.', ''),
              metadata: {
                track: trackDisplayName || carInfo.track,
                car: carScreenName || carInfo.car,
                lapTime: 0,
                lapTimes: [],
                sectorTimes: [],
                fileName,
                fileSize: stat.size,
                parsedAt: new Date().toISOString()
              }
            };
          }
        }
      }
    } catch (readError) {
      console.error(`${ext} header read error:`, readError.message);
    }

    // Fallback: use filename-derived info
    return {
      type: ext.replace('.', ''),
      metadata: {
        track: carInfo.track,
        car: carInfo.car,
        lapTime: 0,
        lapTimes: [],
        sectorTimes: [],
        fileName,
        fileSize: stat.size,
        parsedAt: new Date().toISOString()
      }
    };
  }

  /**
   * Parse BLAP binary format
   */
  parseBLAP(buf, fileName, fileSize, ext) {
    // Read car path at 0x90
    const carPath = this.readString(buf, 0x90, 64);
    const carName = this.mapCarPath(carPath) || carPath || this.extractInfoFromFilename(fileName).car;

    // Read driver name at 0x10
    const driverName = this.readString(buf, 0x10, 124);

    // Find track path by scanning strings in the buffer
    const trackInfo = this.findTrackInBLAP(buf);

    // Find lap time float
    const lapTime = this.findLapTimeInBLAP(buf);

    console.log(`BLAP parsed: car="${carName}" (${carPath}), track="${trackInfo.displayName}" (${trackInfo.path}), lap=${lapTime.toFixed(3)}s, driver="${driverName}"`);

    return {
      type: ext ? ext.replace('.', '') : 'blap',
      metadata: {
        track: trackInfo.displayName || 'Unknown Track',
        trackPath: trackInfo.path,
        car: carName,
        carPath,
        driverName,
        lapTime,
        lapTimes: lapTime > 0 ? [{ lap: 1, time: lapTime }] : [],
        sectorTimes: [],
        fileName,
        fileSize,
        parsedAt: new Date().toISOString()
      }
    };
  }

  /**
   * Scan BLAP buffer for track path strings
   * iRacing track paths are short identifiers like "spa", "monza", "silverstone", etc.
   */
  findTrackInBLAP(buf) {
    // Extract all readable strings from the buffer (min 3 chars)
    const strings = [];
    let currentStr = '';
    let strStart = 0;
    const scanLen = Math.min(buf.length, 4096);

    for (let i = 0; i < scanLen; i++) {
      const c = buf[i];
      if (c >= 32 && c <= 126) {
        if (currentStr.length === 0) strStart = i;
        currentStr += String.fromCharCode(c);
      } else {
        if (currentStr.length >= 3) {
          strings.push({ offset: strStart, value: currentStr });
        }
        currentStr = '';
      }
    }

    // Check each string against known track paths
    for (const s of strings) {
      const lower = s.value.toLowerCase();
      // Skip known non-track strings
      if (lower.includes('porsche') || lower.includes('bmw') || lower.includes('ferrari') ||
          lower.includes('audi') || lower.includes('mercedes') || lower.includes('mclaren') ||
          lower.includes('undefined') || lower.includes('2024') || lower.includes('2025') ||
          lower.includes('cccccc') || lower.includes('000000') || /^\d+$/.test(lower)) {
        continue;
      }

      const trackMatch = this.matchTrackPath(lower);
      if (trackMatch) {
        return { path: s.value, displayName: trackMatch };
      }
    }

    return { path: null, displayName: null };
  }

  /**
   * Map iRacing track path fragment to display name
   */
  matchTrackPath(trackStr) {
    const trackMappings = {
      'spa': 'Circuit de Spa-Francorchamps',
      'monza': 'Autodromo Nazionale Monza',
      'silverstone': 'Silverstone Circuit',
      'nurburgring': 'Nurburgring',
      'nordschleife': 'Nurburgring Nordschleife',
      'lemans': 'Circuit de la Sarthe (Le Mans)',
      'daytona': 'Daytona International Speedway',
      'watkinsglen': 'Watkins Glen International',
      'imola': 'Autodromo Enzo e Dino Ferrari (Imola)',
      'bathurst': 'Mount Panorama Circuit (Bathurst)',
      'suzuka': 'Suzuka International Racing Course',
      'brands_hatch': 'Brands Hatch',
      'brandshatch': 'Brands Hatch',
      'cota': 'Circuit of the Americas',
      'interlagos': 'Autodromo Jose Carlos Pace (Interlagos)',
      'barcelona': 'Circuit de Barcelona-Catalunya',
      'catalunyagp': 'Circuit de Barcelona-Catalunya',
      'hungaroring': 'Hungaroring',
      'mugello': 'Mugello Circuit',
      'paul_ricard': 'Circuit Paul Ricard',
      'paulricard': 'Circuit Paul Ricard',
      'zandvoort': 'Circuit Zandvoort',
      'portimao': 'Autodromo Internacional do Algarve',
      'algarve': 'Autodromo Internacional do Algarve',
      'kyalami': 'Kyalami Grand Prix Circuit',
      'fuji': 'Fuji Speedway',
      'laguna': 'WeatherTech Raceway Laguna Seca',
      'lagunaseca': 'WeatherTech Raceway Laguna Seca',
      'sebring': 'Sebring International Raceway',
      'roadamerica': 'Road America',
      'roadatlanta': 'Road Atlanta',
      'misano': 'Misano World Circuit',
      'donington': 'Donington Park',
      'snetterton': 'Snetterton Circuit',
      'oultonpark': 'Oulton Park',
      'indianapolis': 'Indianapolis Motor Speedway',
      'indy': 'Indianapolis Motor Speedway',
      'mosport': 'Canadian Tire Motorsport Park',
      'motegi': 'Twin Ring Motegi',
      'hockenheim': 'Hockenheimring',
      'redbullring': 'Red Bull Ring',
      'spielberg': 'Red Bull Ring',
      'phillip_island': 'Phillip Island Circuit',
      'phillipisland': 'Phillip Island Circuit',
      'okayama': 'Okayama International Circuit',
      'tsukuba': 'Tsukuba Circuit',
      'charlotte': 'Charlotte Motor Speedway',
      'longbeach': 'Streets of Long Beach',
      'detroit': 'Raceway at Belle Isle',
      'montreal': 'Circuit Gilles Villeneuve',
      'sandown': 'Sandown Raceway',
      'knockhill': 'Knockhill Racing Circuit',
      'oran_park': 'Oran Park Raceway',
      'oranpark': 'Oran Park Raceway',
      'winton': 'Winton Motor Raceway'
    };

    // Check if the string starts with or contains a known track path
    for (const [key, name] of Object.entries(trackMappings)) {
      // Match at the start of the path (before any \ or / separators)
      const pathBase = trackStr.split(/[\\\/]/)[0];
      if (pathBase === key || trackStr.startsWith(key + '\\') || trackStr.startsWith(key + '/')) {
        return name;
      }
    }

    // Also try substring matching for less common formats
    for (const [key, name] of Object.entries(trackMappings)) {
      if (trackStr.includes(key)) {
        return name;
      }
    }

    return null;
  }

  /**
   * Find lap time float in BLAP buffer
   * Scans the metadata region (0x400-0x800) for float values in a reasonable lap time range
   */
  findLapTimeInBLAP(buf) {
    // First try the known offset 0x5B4
    if (buf.length > 0x5B8) {
      const knownTime = buf.readFloatLE(0x5B4);
      if (knownTime > 30 && knownTime < 600) {
        return knownTime;
      }
    }

    // Scan wider region for a reasonable lap time float
    const scanStart = 0x400;
    const scanEnd = Math.min(0x800, buf.length - 4);

    for (let i = scanStart; i < scanEnd; i += 4) {
      const f = buf.readFloatLE(i);
      // Lap times typically 60-600 seconds, with fractional part
      if (f > 60 && f < 600 && f !== Math.floor(f)) {
        return f;
      }
    }

    return 0;
  }

  /**
   * Map car path identifier to display name
   */
  mapCarPath(carPath) {
    if (!carPath) return null;

    const carMappings = {
      'porsche992rgt3': 'Porsche 911 GT3 R (992)',
      'bmwm4gt3': 'BMW M4 GT3',
      'ferrari296gt3': 'Ferrari 296 GT3',
      'audir8lmsevoii': 'Audi R8 LMS EVO II GT3',
      'mercedesamggt3evo': 'Mercedes-AMG GT3 EVO',
      'mclarengt3': 'McLaren 720S GT3',
      'lamborghinievogt3': 'Lamborghini Huracan GT3 EVO',
      'astonmartingt3': 'Aston Martin Vantage GT3',
      'corvettez06gt3r': 'Chevrolet Corvette Z06 GT3.R',
      'fordgt3': 'Ford Mustang GT3',
      'lexusrcfgt3': 'Lexus RC F GT3'
    };

    const key = carPath.toLowerCase().replace(/[^a-z0-9]/g, '');
    return carMappings[key] || null;
  }

  /**
   * Try to extract car/track info from iRacing filename conventions
   * e.g. "1_1770926596963_313251_porsche992rgt3.blap" -> car: porsche992rgt3
   */
  extractInfoFromFilename(fileName) {
    const baseName = path.basename(fileName).replace(/\.\w+$/, '');

    let car = 'Unknown Car';
    let track = 'Unknown Track';

    // Try to find car path in filename using mapCarPath
    const lowerName = baseName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const parts = baseName.split('_').filter(p => !/^\d+$/.test(p));

    for (const part of parts) {
      const mapped = this.mapCarPath(part);
      if (mapped) {
        car = mapped;
        break;
      }
    }

    // If not found by parts, try entire cleaned name
    if (car === 'Unknown Car') {
      const mapped = this.mapCarPath(lowerName);
      if (mapped) car = mapped;
    }

    // Last resort: clean up filename parts
    if (car === 'Unknown Car' && parts.length > 0) {
      car = parts.join(' ');
    }

    return { car, track };
  }

  /**
   * Parse IBT binary header
   *
   * Header layout:
   * 0x00: int32 version
   * 0x04: int32 status
   * 0x08: int32 tickRate
   * 0x0C: int32 sessionInfoUpdate
   * 0x10: int32 sessionInfoLen
   * 0x14: int32 sessionInfoOffset
   * 0x18: int32 numVars
   * 0x1C: int32 varHeaderOffset
   * 0x20: int32 numBuf
   * 0x24: int32 bufLen (size of each data record)
   * 0x28: int32[2] padding
   * 0x30: int32 varBufTickOffset
   * 0x34: int32 varBufOffset (start of data records)
   */
  parseIBTHeader(buffer) {
    if (buffer.length < 0x40) {
      throw new Error('File too small to be a valid IBT file');
    }

    const version = buffer.readInt32LE(0x00);
    const status = buffer.readInt32LE(0x04);
    const tickRate = buffer.readInt32LE(0x08);
    const sessionInfoLen = buffer.readInt32LE(0x10);
    const sessionInfoOffset = buffer.readInt32LE(0x14);
    const numVars = buffer.readInt32LE(0x18);
    const varHeaderOffset = buffer.readInt32LE(0x1C);
    const numBuf = buffer.readInt32LE(0x20);
    const bufLen = buffer.readInt32LE(0x24);
    const dataOffset = buffer.readInt32LE(0x34);

    const totalRecords = Math.floor((buffer.length - dataOffset) / bufLen);

    return {
      version,
      status,
      tickRate,
      sessionInfoLen,
      sessionInfoOffset,
      numVars,
      varHeaderOffset,
      numBuf,
      bufLen,
      dataOffset,
      totalRecords
    };
  }

  /**
   * Parse session info YAML from the IBT file
   * Extracts track name, car name, session type, etc.
   */
  parseSessionInfo(buffer, header) {
    const yamlText = buffer.slice(
      header.sessionInfoOffset,
      header.sessionInfoOffset + header.sessionInfoLen
    ).toString('ascii');

    // Simple YAML value extraction
    const getValue = (key) => {
      const regex = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm');
      const match = yamlText.match(regex);
      return match ? match[1].trim() : null;
    };

    const trackName = getValue('TrackName');
    const trackDisplayName = getValue('TrackDisplayName');
    const trackShortName = getValue('TrackDisplayShortName');
    const trackConfig = getValue('TrackConfigName');
    const trackLength = getValue('TrackLength');
    const sessionType = getValue('SessionType');
    const driverCarIdx = parseInt(getValue('DriverCarIdx')) || 0;

    // Find the driver's car name using DriverCarIdx
    let carName = null;
    let carPath = null;
    const driverPattern = new RegExp(
      `CarIdx:\\s*${driverCarIdx}[\\s\\S]*?CarScreenName:\\s*(.+)`,
      'm'
    );
    const carMatch = yamlText.match(driverPattern);
    if (carMatch) {
      carName = carMatch[1].trim();
    }

    // Also try to get CarPath
    const carPathPattern = new RegExp(
      `CarIdx:\\s*${driverCarIdx}[\\s\\S]*?CarPath:\\s*(.+)`,
      'm'
    );
    const carPathMatch = yamlText.match(carPathPattern);
    if (carPathMatch) {
      carPath = carPathMatch[1].trim();
    }

    // Fallback: try to get car name from filename if not found
    if (!carName) {
      carName = getValue('CarScreenName');
    }

    return {
      trackName,
      trackDisplayName,
      trackShortName,
      trackConfig,
      trackLength,
      sessionType,
      driverCarIdx,
      carName,
      carPath
    };
  }

  /**
   * Parse variable headers to find telemetry channel offsets
   *
   * Each variable header is 144 bytes:
   * 0x00: int32 type (1=char, 2=bool/int32, 3=bitfield, 4=float, 5=double)
   * 0x04: int32 offset (offset within each data record)
   * 0x08: int32 count
   * 0x0C: int8 countAsTime
   * 0x0D: int8[3] pad
   * 0x10: char[32] name
   * 0x30: char[64] desc
   * 0x70: char[32] unit
   */
  parseVarHeaders(buffer, header) {
    const vars = {};
    const VAR_HEADER_SIZE = 144;

    for (let i = 0; i < header.numVars; i++) {
      const offset = header.varHeaderOffset + (i * VAR_HEADER_SIZE);

      if (offset + VAR_HEADER_SIZE > buffer.length) break;

      const type = buffer.readInt32LE(offset);
      const dataOffset = buffer.readInt32LE(offset + 4);
      const count = buffer.readInt32LE(offset + 8);
      const name = this.readString(buffer, offset + 16, 32);

      vars[name] = { type, dataOffset, count };
    }

    return vars;
  }

  /**
   * Extract lap times from telemetry data records
   */
  extractLaps(buffer, header, varHeaders) {
    const lapVar = varHeaders['Lap'];
    const bestLapTimeVar = varHeaders['LapBestLapTime'];
    const lastLapTimeVar = varHeaders['LapLastLapTime'];
    const currentLapTimeVar = varHeaders['LapCurrentLapTime'];

    if (!lapVar) {
      return { lapTimes: [], bestLapTime: 0 };
    }

    let lastLap = -1;
    let bestLapTime = 0;
    const lapTimes = [];

    for (let i = 0; i < header.totalRecords; i++) {
      const recOffset = header.dataOffset + (i * header.bufLen);
      if (recOffset + header.bufLen > buffer.length) break;

      const lap = buffer.readInt32LE(recOffset + lapVar.dataOffset);
      const lastLapTime = lastLapTimeVar
        ? buffer.readFloatLE(recOffset + lastLapTimeVar.dataOffset)
        : 0;
      const bestLap = bestLapTimeVar
        ? buffer.readFloatLE(recOffset + bestLapTimeVar.dataOffset)
        : 0;

      if (lap !== lastLap && lap >= 0) {
        if (lastLapTime > 0 && lap > 0) {
          // Avoid duplicates
          const exists = lapTimes.some(l => Math.abs(l.time - lastLapTime) < 0.001);
          if (!exists) {
            lapTimes.push({
              lap: lap,
              time: lastLapTime
            });
          }
        }
        if (bestLap > 0) {
          bestLapTime = bestLap;
        }
        lastLap = lap;
      }
    }

    return { lapTimes, bestLapTime };
  }

  /**
   * Extract downsampled telemetry data for visualization
   * Samples at 1 Hz (every tickRate records)
   */
  extractTelemetry(buffer, header, varHeaders) {
    const channels = {
      speed: varHeaders['Speed'],
      throttle: varHeaders['Throttle'],
      brake: varHeaders['Brake'],
      steering: varHeaders['SteeringWheelAngle'],
      rpm: varHeaders['RPM'],
      gear: varHeaders['Gear'],
      lapDist: varHeaders['LapDist'],
      lapDistPct: varHeaders['LapDistPct'],
      lap: varHeaders['Lap'],
      currentLapTime: varHeaders['LapCurrentLapTime']
    };

    const samples = [];
    const downsampleRate = header.tickRate; // 1 sample per second

    for (let i = 0; i < header.totalRecords; i += downsampleRate) {
      const recOffset = header.dataOffset + (i * header.bufLen);
      if (recOffset + header.bufLen > buffer.length) break;

      const sample = { time: i / header.tickRate };

      if (channels.speed) {
        sample.speed = buffer.readFloatLE(recOffset + channels.speed.dataOffset) * 3.6; // m/s to km/h
      }
      if (channels.throttle) {
        sample.throttle = buffer.readFloatLE(recOffset + channels.throttle.dataOffset) * 100;
      }
      if (channels.brake) {
        sample.brake = buffer.readFloatLE(recOffset + channels.brake.dataOffset) * 100;
      }
      if (channels.steering) {
        sample.steering = buffer.readFloatLE(recOffset + channels.steering.dataOffset);
      }
      if (channels.rpm) {
        sample.rpm = buffer.readFloatLE(recOffset + channels.rpm.dataOffset);
      }
      if (channels.gear) {
        sample.gear = buffer.readInt32LE(recOffset + channels.gear.dataOffset);
      }
      if (channels.lapDist) {
        sample.lapDist = buffer.readFloatLE(recOffset + channels.lapDist.dataOffset);
      }
      if (channels.lapDistPct) {
        sample.lapDistPct = buffer.readFloatLE(recOffset + channels.lapDistPct.dataOffset);
      }
      if (channels.lap) {
        sample.lap = buffer.readInt32LE(recOffset + channels.lap.dataOffset);
      }

      samples.push(sample);
    }

    return samples;
  }

  /**
   * Read a variable value from a data record, respecting its type
   */
  readVarValue(buffer, recOffset, varHeader) {
    const offset = recOffset + varHeader.dataOffset;
    if (offset + 8 > buffer.length) return 0;
    switch (varHeader.type) {
      case 1: return buffer.readInt8(offset);
      case 2: return buffer.readInt32LE(offset);
      case 3: return buffer.readInt32LE(offset);
      case 4: return buffer.readFloatLE(offset);
      case 5: return buffer.readDoubleLE(offset);
      default: return buffer.readFloatLE(offset);
    }
  }

  /**
   * Extract high-resolution telemetry for a specific lap
   * Used for detailed visualization (track map, driver inputs, speed trace)
   * Returns ~10Hz data (every 6th sample at 60Hz tick rate)
   */
  extractLapTelemetry(buffer, header, varHeaders, targetLap) {
    const channels = {
      speed: varHeaders['Speed'],
      throttle: varHeaders['Throttle'],
      brake: varHeaders['Brake'],
      steering: varHeaders['SteeringWheelAngle'],
      rpm: varHeaders['RPM'],
      gear: varHeaders['Gear'],
      lapDist: varHeaders['LapDist'],
      lapDistPct: varHeaders['LapDistPct'],
      lap: varHeaders['Lap'],
      lat: varHeaders['Lat'],
      lon: varHeaders['Lon'],
      alt: varHeaders['Alt'],
      yaw: varHeaders['Yaw'],
      velocityX: varHeaders['VelocityX'],
      velocityZ: varHeaders['VelocityZ']
    };

    if (!channels.lap) return [];

    const samples = [];
    // Target ~10Hz: at 60Hz tick rate, take every 6th sample
    const downsampleRate = Math.max(1, Math.floor(header.tickRate / 10));

    for (let i = 0; i < header.totalRecords; i++) {
      const recOffset = header.dataOffset + (i * header.bufLen);
      if (recOffset + header.bufLen > buffer.length) break;

      const lap = buffer.readInt32LE(recOffset + channels.lap.dataOffset);
      if (lap !== targetLap) continue;
      if (i % downsampleRate !== 0) continue;

      const sample = {};

      if (channels.speed) sample.speed = this.readVarValue(buffer, recOffset, channels.speed) * 3.6;
      if (channels.throttle) sample.throttle = this.readVarValue(buffer, recOffset, channels.throttle) * 100;
      if (channels.brake) sample.brake = this.readVarValue(buffer, recOffset, channels.brake) * 100;
      if (channels.steering) sample.steering = this.readVarValue(buffer, recOffset, channels.steering);
      if (channels.rpm) sample.rpm = this.readVarValue(buffer, recOffset, channels.rpm);
      if (channels.gear) sample.gear = buffer.readInt32LE(recOffset + channels.gear.dataOffset);
      if (channels.lapDist) sample.dist = this.readVarValue(buffer, recOffset, channels.lapDist);
      if (channels.lapDistPct) sample.distPct = this.readVarValue(buffer, recOffset, channels.lapDistPct);
      if (channels.lat) sample.lat = this.readVarValue(buffer, recOffset, channels.lat);
      if (channels.lon) sample.lon = this.readVarValue(buffer, recOffset, channels.lon);

      samples.push(sample);
    }

    return samples;
  }

  /**
   * Parse an IBT file and return telemetry for a specific lap number
   */
  async parseLapTelemetry(filePath, lapNumber) {
    const buffer = await fs.readFile(filePath);
    const header = this.parseIBTHeader(buffer);
    const varHeaders = this.parseVarHeaders(buffer, header);
    const sessionInfo = this.parseSessionInfo(buffer, header);

    const samples = this.extractLapTelemetry(buffer, header, varHeaders, lapNumber);

    // Calculate track length from max distance in the lap
    let trackLength = 0;
    if (samples.length > 0) {
      trackLength = Math.max(...samples.map(s => s.dist || 0));
    }
    if (sessionInfo.trackLength) {
      const parsed = parseFloat(sessionInfo.trackLength);
      if (parsed > 0) trackLength = parsed * 1000; // km to m
    }

    return {
      samples,
      trackLength,
      sampleCount: samples.length,
      tickRate: header.tickRate,
      track: sessionInfo.trackDisplayName || sessionInfo.trackName,
      car: sessionInfo.carName,
      hasTrackMap: samples.some(s => s.lat !== undefined && s.lat !== 0)
    };
  }

  /**
   * Read null-terminated ASCII string from buffer
   */
  readString(buffer, offset, maxLength) {
    let str = '';
    for (let i = 0; i < maxLength; i++) {
      const char = buffer[offset + i];
      if (char === 0) break;
      str += String.fromCharCode(char);
    }
    return str.trim();
  }

  /**
   * Export telemetry to JSON (for API responses)
   */
  exportToJSON(parsedData, downsample = 10) {
    const downsampled = (parsedData.telemetry || []).filter((_, i) => i % downsample === 0);

    return {
      metadata: parsedData.metadata,
      laps: parsedData.laps,
      telemetry: downsampled,
      dataPoints: downsampled.length
    };
  }
}

module.exports = new TelemetryParser();
