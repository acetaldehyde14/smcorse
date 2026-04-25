const parser = require('./parser');

/**
 * Lap Comparison Engine
 * Compares driver lap vs reference lap (BLAP/OLAP)
 */

class ComparisonEngine {
  /**
   * Compare two laps and generate analysis
   */
  async compareLaps(driverLap, referenceLap) {
    try {
      // Ensure both laps are parsed
      const driver = driverLap.telemetry ? driverLap : await parser.parseFile(driverLap);
      const reference = referenceLap.telemetry ? referenceLap : await parser.parseFile(referenceLap);

      // Align telemetry by distance
      const aligned = this.alignTelemetry(driver.telemetry, reference.telemetry);

      // Compare overall lap time
      const timeDelta = driver.lapInfo.lapTime - reference.lapInfo.lapTime;

      // Compare sectors
      const sectorComparison = this.compareSectors(
        driver.lapInfo.sectorTimes,
        reference.lapInfo.sectorTimes
      );

      // Compare corners
      const cornerComparison = this.compareCorners(
        driver.telemetry,
        reference.telemetry,
        aligned
      );

      // Analyze inputs
      const inputAnalysis = this.analyzeInputs(aligned);

      // Find biggest time losses
      const topIssues = this.identifyTopIssues(cornerComparison, inputAnalysis);

      return {
        timeDelta,
        sectorComparison,
        cornerComparison,
        inputAnalysis,
        topIssues,
        metadata: {
          driverLap: driver.metadata,
          referenceLap: reference.metadata
        }
      };
    } catch (error) {
      console.error('Comparison error:', error);
      throw new Error(`Failed to compare laps: ${error.message}`);
    }
  }

  /**
   * Align two telemetry datasets by distance
   */
  alignTelemetry(driverTelem, referenceTelem) {
    const aligned = [];
    const maxDistance = Math.min(
      driverTelem[driverTelem.length - 1].distance,
      referenceTelem[referenceTelem.length - 1].distance
    );

    const distanceInterval = maxDistance / 500; // 500 comparison points
    let driverIdx = 0;
    let referenceIdx = 0;

    for (let dist = 0; dist < maxDistance; dist += distanceInterval) {
      // Find closest driver sample
      while (driverIdx < driverTelem.length - 1 && 
             driverTelem[driverIdx].distance < dist) {
        driverIdx++;
      }

      // Find closest reference sample
      while (referenceIdx < referenceTelem.length - 1 && 
             referenceTelem[referenceIdx].distance < dist) {
        referenceIdx++;
      }

      const driverSample = driverTelem[driverIdx];
      const referenceSample = referenceTelem[referenceIdx];

      if (driverSample && referenceSample) {
        aligned.push({
          distance: dist,
          driver: driverSample,
          reference: referenceSample,
          speedDelta: driverSample.speed - referenceSample.speed,
          throttleDelta: driverSample.throttle - referenceSample.throttle,
          brakeDelta: driverSample.brake - referenceSample.brake,
          steeringDelta: driverSample.steering - referenceSample.steering
        });
      }
    }

    return aligned;
  }

  /**
   * Compare sector times
   */
  compareSectors(driverSectors, referenceSectors) {
    return driverSectors.map((driverTime, index) => {
      const refTime = referenceSectors[index];
      const delta = driverTime - refTime;
      const percentage = ((delta / refTime) * 100).toFixed(2);

      return {
        sector: index + 1,
        driverTime: driverTime.toFixed(3),
        referenceTime: refTime.toFixed(3),
        delta: delta.toFixed(3),
        percentage: percentage + '%',
        status: delta <= 0 ? 'faster' : 'slower'
      };
    });
  }

  /**
   * Compare corners
   */
  compareCorners(driverTelem, referenceTelem, aligned) {
    const driverCorners = parser.identifyCorners(driverTelem);
    const referenceCorners = parser.identifyCorners(referenceTelem);

    const comparison = [];

    // Match corners by distance
    for (let i = 0; i < Math.min(driverCorners.length, referenceCorners.length); i++) {
      const dCorner = driverCorners[i];
      const rCorner = referenceCorners[i];

      const entrySpeedDelta = dCorner.entrySpeed - rCorner.entrySpeed;
      const apexSpeedDelta = dCorner.apexSpeed - rCorner.apexSpeed;
      const exitSpeedDelta = dCorner.exitSpeed - rCorner.exitSpeed;

      // Estimate time loss
      const avgSpeedDelta = (entrySpeedDelta + apexSpeedDelta + exitSpeedDelta) / 3;
      const cornerDistance = 100; // Approximate corner length in meters
      const estimatedTimeLoss = (cornerDistance / dCorner.apexSpeed) - 
                                 (cornerDistance / rCorner.apexSpeed);

      comparison.push({
        corner: i + 1,
        distance: dCorner.distance,
        entry: {
          driverSpeed: dCorner.entrySpeed.toFixed(1),
          referenceSpeed: rCorner.entrySpeed.toFixed(1),
          delta: entrySpeedDelta.toFixed(1)
        },
        apex: {
          driverSpeed: dCorner.apexSpeed.toFixed(1),
          referenceSpeed: rCorner.apexSpeed.toFixed(1),
          delta: apexSpeedDelta.toFixed(1)
        },
        exit: {
          driverSpeed: dCorner.exitSpeed.toFixed(1),
          referenceSpeed: rCorner.exitSpeed.toFixed(1),
          delta: exitSpeedDelta.toFixed(1)
        },
        estimatedTimeLoss: estimatedTimeLoss.toFixed(3),
        issue: this.diagnoseCornerIssue(entrySpeedDelta, apexSpeedDelta, exitSpeedDelta)
      });
    }

    return comparison;
  }

  /**
   * Diagnose corner issue based on speed deltas
   */
  diagnoseCornerIssue(entryDelta, apexDelta, exitDelta) {
    if (entryDelta < -3) {
      return 'Too slow on entry - brake later or carry more speed';
    } else if (apexDelta < -3) {
      return 'Low apex speed - work on line and corner speed';
    } else if (exitDelta < -3) {
      return 'Poor exit - earlier throttle application needed';
    } else if (entryDelta > 3) {
      return 'Entry too fast - may be overdriving';
    } else if (Math.abs(entryDelta) < 2 && Math.abs(apexDelta) < 2 && Math.abs(exitDelta) < 2) {
      return 'Good corner execution';
    } else {
      return 'Minor differences - refinement needed';
    }
  }

  /**
   * Analyze driver inputs
   */
  analyzeInputs(aligned) {
    const brakeAnalysis = this.analyzeBraking(aligned);
    const throttleAnalysis = this.analyzeThrottle(aligned);
    const steeringAnalysis = this.analyzeSteering(aligned);

    return {
      braking: brakeAnalysis,
      throttle: throttleAnalysis,
      steering: steeringAnalysis
    };
  }

  /**
   * Analyze braking inputs
   */
  analyzeBraking(aligned) {
    const brakePoints = [];
    
    for (let i = 1; i < aligned.length; i++) {
      const current = aligned[i];
      const prev = aligned[i - 1];
      
      // Find brake application points
      if (prev.driver.brake < 0.1 && current.driver.brake >= 0.1) {
        const refBrakeIdx = this.findNearestBrakePoint(aligned, i);
        
        if (refBrakeIdx !== -1) {
          const distanceDiff = current.distance - aligned[refBrakeIdx].distance;
          
          brakePoints.push({
            distance: current.distance,
            driverSpeed: current.driver.speed,
            referenceSpeed: aligned[refBrakeIdx].reference.speed,
            distanceDifference: distanceDiff,
            timing: distanceDiff < 0 ? 'early' : distanceDiff > 0 ? 'late' : 'matched',
            issue: distanceDiff < -10 ? 'Braking too early' : 
                   distanceDiff > 10 ? 'Braking too late' : 'Good brake point'
          });
        }
      }
    }

    return {
      brakePoints,
      summary: this.summarizeBraking(brakePoints)
    };
  }

  /**
   * Find nearest brake point in reference lap
   */
  findNearestBrakePoint(aligned, startIdx) {
    const searchRange = 50; // Look within 50 samples
    
    for (let i = Math.max(0, startIdx - searchRange); 
         i < Math.min(aligned.length, startIdx + searchRange); 
         i++) {
      const prev = aligned[Math.max(0, i - 1)];
      const current = aligned[i];
      
      if (prev.reference.brake < 0.1 && current.reference.brake >= 0.1) {
        return i;
      }
    }
    
    return -1;
  }

  /**
   * Summarize braking analysis
   */
  summarizeBraking(brakePoints) {
    if (brakePoints.length === 0) return 'No brake points analyzed';

    const earlyCount = brakePoints.filter(bp => bp.timing === 'early').length;
    const lateCount = brakePoints.filter(bp => bp.timing === 'late').length;
    const avgDiff = brakePoints.reduce((sum, bp) => sum + bp.distanceDifference, 0) / brakePoints.length;

    if (earlyCount > lateCount * 2) {
      return `Braking too early on average (${earlyCount}/${brakePoints.length} points). Try braking ${Math.abs(avgDiff).toFixed(0)}m later.`;
    } else if (lateCount > earlyCount * 2) {
      return `Braking too late on average (${lateCount}/${brakePoints.length} points). Risk of missing apexes.`;
    } else {
      return 'Brake timing generally good. Minor adjustments needed.';
    }
  }

  /**
   * Analyze throttle inputs
   */
  analyzeThrottle(aligned) {
    let smoothnessScore = 0;
    let totalApplications = 0;

    for (let i = 1; i < aligned.length - 1; i++) {
      const prev = aligned[i - 1].driver.throttle;
      const current = aligned[i].driver.throttle;
      const next = aligned[i + 1].driver.throttle;

      // Check for smoothness (avoid sudden changes)
      const changePrev = Math.abs(current - prev);
      const changeNext = Math.abs(next - current);

      if (current > 0.5) {
        totalApplications++;
        if (changePrev < 0.2 && changeNext < 0.2) {
          smoothnessScore++;
        }
      }
    }

    const smoothnessPercentage = totalApplications > 0 
      ? (smoothnessScore / totalApplications * 100).toFixed(1) 
      : 0;

    return {
      smoothnessScore: smoothnessPercentage + '%',
      summary: smoothnessPercentage > 80 
        ? 'Smooth throttle application' 
        : smoothnessPercentage > 60 
        ? 'Throttle application could be smoother'
        : 'Jerky throttle inputs - work on smoother progression'
    };
  }

  /**
   * Analyze steering inputs
   */
  analyzeSteering(aligned) {
    let smoothInputs = 0;
    let totalInputs = 0;

    for (let i = 1; i < aligned.length - 1; i++) {
      const current = Math.abs(aligned[i].driver.steering);
      
      if (current > 0.1) {
        totalInputs++;
        const prev = Math.abs(aligned[i - 1].driver.steering);
        const change = Math.abs(current - prev);
        
        if (change < 0.1) smoothInputs++;
      }
    }

    const smoothnessPercentage = totalInputs > 0 
      ? (smoothInputs / totalInputs * 100).toFixed(1) 
      : 0;

    return {
      smoothnessScore: smoothnessPercentage + '%',
      summary: smoothnessPercentage > 85 
        ? 'Smooth steering inputs' 
        : 'Work on smoother steering transitions'
    };
  }

  /**
   * Identify top issues (ranked by time loss potential)
   */
  identifyTopIssues(cornerComparison, inputAnalysis) {
    const issues = [];

    // Add corner issues
    cornerComparison.forEach(corner => {
      const timeLoss = parseFloat(corner.estimatedTimeLoss);
      if (timeLoss > 0.05) {
        issues.push({
          type: 'corner',
          corner: corner.corner,
          timeLoss: timeLoss,
          description: corner.issue,
          priority: timeLoss > 0.2 ? 'high' : timeLoss > 0.1 ? 'medium' : 'low'
        });
      }
    });

    // Add input issues
    if (inputAnalysis.braking.summary.includes('too early')) {
      issues.push({
        type: 'braking',
        timeLoss: 0.3,
        description: inputAnalysis.braking.summary,
        priority: 'high'
      });
    }

    // Sort by time loss
    issues.sort((a, b) => b.timeLoss - a.timeLoss);

    return issues.slice(0, 5); // Top 5 issues
  }
}

module.exports = new ComparisonEngine();
