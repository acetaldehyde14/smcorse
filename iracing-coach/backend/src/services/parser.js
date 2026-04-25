const fs = require('fs').promises;
const path = require('path');

/**
 * iRacing Telemetry Parser
 * Supports .ibt, .blap, and .olap files
 */

class TelemetryParser {
  constructor() {
    this.HEADER_SIZE = 112; // Approximate header size
  }

  /**
   * Parse any telemetry file type
   */
  async parseFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    switch (ext) {
      case '.ibt':
        return await this.parseIBT(filePath);
      case '.blap':
        return await this.parseBLAP(filePath);
      case '.olap':
        return await this.parseOLAP(filePath);
      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  /**
   * Parse IBT (iRacing Binary Telemetry) file
   */
  async parseIBT(filePath) {
    try {
      const buffer = await fs.readFile(filePath);
      
      // Parse header
      const header = this.parseIBTHeader(buffer);
      
      // Parse telemetry data
      const telemetry = this.parseIBTTelemetry(buffer, header);
      
      // Extract lap information
      const lapInfo = this.extractLapInfo(telemetry);
      
      return {
        type: 'ibt',
        header,
        telemetry,
        lapInfo,
        metadata: {
          track: header.trackName,
          car: header.carName,
          lapTime: lapInfo.lapTime,
          sectorTimes: lapInfo.sectorTimes,
          fileName: path.basename(filePath),
          fileSize: buffer.length,
          parsedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('IBT parsing error:', error);
      throw new Error(`Failed to parse IBT file: ${error.message}`);
    }
  }

  /**
   * Parse BLAP (Best Lap) file
   */
  async parseBLAP(filePath) {
    try {
      const buffer = await fs.readFile(filePath);
      
      const header = this.parseLapFileHeader(buffer);
      const telemetry = this.parseLapFileTelemetry(buffer, header);
      const lapInfo = this.extractLapInfo(telemetry);
      
      return {
        type: 'blap',
        header,
        telemetry,
        lapInfo,
        metadata: {
          track: header.trackName,
          car: header.carName,
          lapTime: lapInfo.lapTime,
          sectorTimes: lapInfo.sectorTimes,
          fileName: path.basename(filePath),
          fileSize: buffer.length,
          parsedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('BLAP parsing error:', error);
      throw new Error(`Failed to parse BLAP file: ${error.message}`);
    }
  }

  /**
   * Parse OLAP (Optimal Lap) file
   */
  async parseOLAP(filePath) {
    try {
      const buffer = await fs.readFile(filePath);
      
      const header = this.parseLapFileHeader(buffer);
      const telemetry = this.parseLapFileTelemetry(buffer, header);
      const lapInfo = this.extractLapInfo(telemetry);
      
      return {
        type: 'olap',
        header,
        telemetry,
        lapInfo,
        metadata: {
          track: header.trackName,
          car: header.carName,
          lapTime: lapInfo.lapTime,
          sectorTimes: lapInfo.sectorTimes,
          isOptimal: true,
          fileName: path.basename(filePath),
          fileSize: buffer.length,
          parsedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('OLAP parsing error:', error);
      throw new Error(`Failed to parse OLAP file: ${error.message}`);
    }
  }

  /**
   * Parse IBT header
   */
  parseIBTHeader(buffer) {
    let offset = 0;
    
    // Read version
    const version = buffer.readInt32LE(offset);
    offset += 4;
    
    // Read track name (64 bytes)
    const trackName = this.readString(buffer, offset, 64);
    offset += 64;
    
    // Read car name (64 bytes)
    const carName = this.readString(buffer, offset, 64);
    offset += 64;
    
    // Skip to sample count
    offset = 112;
    const numSamples = buffer.readInt32LE(offset);
    
    return {
      version,
      trackName,
      carName,
      numSamples,
      headerSize: this.HEADER_SIZE
    };
  }

  /**
   * Parse BLAP/OLAP header (similar structure to IBT)
   */
  parseLapFileHeader(buffer) {
    let offset = 0;
    
    const version = buffer.readInt32LE(offset);
    offset += 4;
    
    const trackName = this.readString(buffer, offset, 64);
    offset += 64;
    
    const carName = this.readString(buffer, offset, 64);
    offset += 64;
    
    const lapTime = buffer.readFloatLE(offset);
    offset += 4;
    
    const numSamples = buffer.readInt32LE(offset);
    
    return {
      version,
      trackName,
      carName,
      lapTime,
      numSamples,
      headerSize: 140
    };
  }

  /**
   * Parse IBT telemetry samples
   */
  parseIBTTelemetry(buffer, header) {
    const samples = [];
    let offset = header.headerSize;
    const sampleSize = 128; // Approximate sample size in bytes
    
    for (let i = 0; i < Math.min(header.numSamples, 10000); i++) {
      if (offset + sampleSize > buffer.length) break;
      
      const sample = {
        time: buffer.readFloatLE(offset),
        distance: buffer.readFloatLE(offset + 4),
        speed: buffer.readFloatLE(offset + 8),
        throttle: buffer.readFloatLE(offset + 12),
        brake: buffer.readFloatLE(offset + 16),
        steering: buffer.readFloatLE(offset + 20),
        gear: buffer.readInt8(offset + 24),
        rpm: buffer.readFloatLE(offset + 28),
        lat: buffer.readFloatLE(offset + 32),
        lon: buffer.readFloatLE(offset + 36),
        // Additional channels
        clutch: buffer.readFloatLE(offset + 40),
        fuel: buffer.readFloatLE(offset + 44),
        lapDist: buffer.readFloatLE(offset + 48)
      };
      
      samples.push(sample);
      offset += sampleSize;
    }
    
    return samples;
  }

  /**
   * Parse lap file telemetry (BLAP/OLAP)
   */
  parseLapFileTelemetry(buffer, header) {
    const samples = [];
    let offset = header.headerSize;
    const sampleSize = 96; // Lap files have smaller sample size
    
    for (let i = 0; i < Math.min(header.numSamples, 10000); i++) {
      if (offset + sampleSize > buffer.length) break;
      
      const sample = {
        distance: buffer.readFloatLE(offset),
        speed: buffer.readFloatLE(offset + 4),
        throttle: buffer.readFloatLE(offset + 8),
        brake: buffer.readFloatLE(offset + 12),
        steering: buffer.readFloatLE(offset + 16),
        gear: buffer.readInt8(offset + 20),
        rpm: buffer.readFloatLE(offset + 24),
        lat: buffer.readFloatLE(offset + 28),
        lon: buffer.readFloatLE(offset + 32),
        lapDist: buffer.readFloatLE(offset + 36)
      };
      
      samples.push(sample);
      offset += sampleSize;
    }
    
    return samples;
  }

  /**
   * Extract lap information from telemetry
   */
  extractLapInfo(telemetry) {
    if (!telemetry || telemetry.length === 0) {
      return { lapTime: 0, sectorTimes: [0, 0, 0] };
    }

    // Calculate lap time from first to last sample
    const firstSample = telemetry[0];
    const lastSample = telemetry[telemetry.length - 1];
    const lapTime = lastSample.time || lastSample.distance / 100; // Approximate

    // Find sector splits (approximately 1/3 of lap each)
    const totalDistance = lastSample.lapDist || lastSample.distance;
    const sector1End = totalDistance / 3;
    const sector2End = (totalDistance * 2) / 3;

    let sector1Time = 0;
    let sector2Time = 0;
    let sector3Time = 0;

    for (let i = 0; i < telemetry.length; i++) {
      const sample = telemetry[i];
      const dist = sample.lapDist || sample.distance;
      
      if (!sector1Time && dist >= sector1End) {
        sector1Time = sample.time || (i / telemetry.length) * lapTime;
      }
      if (!sector2Time && dist >= sector2End) {
        sector2Time = (sample.time || (i / telemetry.length) * lapTime) - sector1Time;
      }
    }
    
    sector3Time = lapTime - sector1Time - sector2Time;

    return {
      lapTime,
      sectorTimes: [sector1Time, sector2Time, sector3Time],
      totalDistance,
      avgSpeed: this.calculateAvgSpeed(telemetry),
      maxSpeed: this.calculateMaxSpeed(telemetry)
    };
  }

  /**
   * Calculate average speed
   */
  calculateAvgSpeed(telemetry) {
    const speeds = telemetry.map(s => s.speed).filter(s => s > 0);
    return speeds.reduce((a, b) => a + b, 0) / speeds.length;
  }

  /**
   * Calculate max speed
   */
  calculateMaxSpeed(telemetry) {
    return Math.max(...telemetry.map(s => s.speed));
  }

  /**
   * Read null-terminated string from buffer
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
   * Export telemetry to JSON
   */
  exportToJSON(parsedData, downsample = 10) {
    const downsampled = parsedData.telemetry.filter((_, i) => i % downsample === 0);
    
    return {
      metadata: parsedData.metadata,
      lapInfo: parsedData.lapInfo,
      telemetry: downsampled,
      dataPoints: downsampled.length
    };
  }

  /**
   * Get telemetry summary (for database storage)
   */
  getTelemetrySummary(parsedData) {
    const telemetry = parsedData.telemetry;
    
    return {
      numSamples: telemetry.length,
      avgSpeed: parsedData.lapInfo.avgSpeed,
      maxSpeed: parsedData.lapInfo.maxSpeed,
      totalDistance: parsedData.lapInfo.totalDistance,
      brakePoints: this.findBrakePoints(telemetry),
      corners: this.identifyCorners(telemetry)
    };
  }

  /**
   * Find braking points in telemetry
   */
  findBrakePoints(telemetry) {
    const brakePoints = [];
    
    for (let i = 1; i < telemetry.length; i++) {
      const current = telemetry[i];
      const prev = telemetry[i - 1];
      
      // Brake point = brake goes from 0 to >0.1
      if (prev.brake < 0.1 && current.brake >= 0.1) {
        brakePoints.push({
          distance: current.distance,
          speed: current.speed,
          position: { lat: current.lat, lon: current.lon }
        });
      }
    }
    
    return brakePoints;
  }

  /**
   * Identify corners from speed data
   */
  identifyCorners(telemetry) {
    const corners = [];
    const speedThreshold = 0.8; // 80% of max speed
    const maxSpeed = this.calculateMaxSpeed(telemetry);
    
    let inCorner = false;
    let cornerStart = null;
    
    for (let i = 0; i < telemetry.length; i++) {
      const sample = telemetry[i];
      const isSlowPoint = sample.speed < (maxSpeed * speedThreshold);
      
      if (isSlowPoint && !inCorner) {
        // Corner entry
        inCorner = true;
        cornerStart = i;
      } else if (!isSlowPoint && inCorner) {
        // Corner exit
        inCorner = false;
        
        // Find apex (minimum speed in this corner)
        const cornerSamples = telemetry.slice(cornerStart, i);
        const apexIndex = cornerStart + cornerSamples.findIndex(
          s => s.speed === Math.min(...cornerSamples.map(c => c.speed))
        );
        
        corners.push({
          entry: cornerStart,
          apex: apexIndex,
          exit: i,
          entrySpeed: telemetry[cornerStart].speed,
          apexSpeed: telemetry[apexIndex].speed,
          exitSpeed: telemetry[i].speed,
          distance: telemetry[apexIndex].distance
        });
      }
    }
    
    return corners;
  }
}

module.exports = new TelemetryParser();
