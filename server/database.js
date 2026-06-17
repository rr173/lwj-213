const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'topology.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
});

function initDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS topology_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version INTEGER NOT NULL,
          name TEXT,
          devices TEXT NOT NULL,
          links TEXT NOT NULL,
          manual_routes TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS stress_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scenario_name TEXT NOT NULL,
          aborted INTEGER NOT NULL DEFAULT 0,
          total_duration REAL NOT NULL,
          total_flows INTEGER NOT NULL,
          completed_flows INTEGER NOT NULL,
          unreachable_flows INTEGER NOT NULL,
          avg_loss_rate REAL NOT NULL,
          link_stats TEXT NOT NULL,
          flow_details TEXT NOT NULL,
          raw_samples TEXT NOT NULL,
          topology_snapshot TEXT,
          timestamp INTEGER NOT NULL
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS device_configs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          config_data TEXT NOT NULL,
          parsed_devices TEXT NOT NULL,
          parsed_links TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS audit_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          total_alerts INTEGER NOT NULL,
          critical_count INTEGER NOT NULL,
          warning_count INTEGER NOT NULL,
          info_count INTEGER NOT NULL,
          alerts TEXT NOT NULL,
          topology_snapshot TEXT,
          timestamp INTEGER NOT NULL
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS partition_changes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          old_count INTEGER NOT NULL,
          new_count INTEGER NOT NULL,
          trigger_link_id INTEGER,
          trigger_action TEXT,
          trigger_link_name TEXT,
          topology_snapshot TEXT,
          timestamp INTEGER NOT NULL
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_topology_versions_created 
        ON topology_versions(created_at DESC)
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_stress_reports_timestamp 
        ON stress_reports(timestamp DESC)
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_audit_reports_timestamp 
        ON audit_reports(timestamp DESC)
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_partition_changes_timestamp 
        ON partition_changes(timestamp DESC)
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

const MAX_TOPOLOGY_VERSIONS = 20;

function saveTopology(topologyData) {
  return new Promise((resolve, reject) => {
    const { devices, links, manualRoutes, name } = topologyData;

    db.get('SELECT COUNT(*) as count FROM topology_versions', (err, countRow) => {
      if (err) return reject(err);

      const currentCount = countRow.count;

      const deleteOldIfNeeded = () => {
        return new Promise((res, rej) => {
          if (currentCount >= MAX_TOPOLOGY_VERSIONS) {
            const toDelete = currentCount - MAX_TOPOLOGY_VERSIONS + 1;
            db.run(`
              DELETE FROM topology_versions 
              WHERE id IN (
                SELECT id FROM topology_versions 
                ORDER BY created_at ASC 
                LIMIT ?
              )
            `, [toDelete], (err) => {
              if (err) rej(err);
              else res();
            });
          } else {
            res();
          }
        });
      };

      const getNextVersion = () => {
        return new Promise((res, rej) => {
          db.get(
            'SELECT COALESCE(MAX(version), 0) as max_version FROM topology_versions',
            (err, row) => {
              if (err) rej(err);
              else res(row.max_version + 1);
            }
          );
        });
      };

      deleteOldIfNeeded()
        .then(getNextVersion)
        .then((newVersion) => {
          const stmt = db.prepare(`
            INSERT INTO topology_versions 
              (version, name, devices, links, manual_routes, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `);

          stmt.run(
            newVersion,
            name || `版本 ${newVersion}`,
            JSON.stringify(devices),
            JSON.stringify(links),
            JSON.stringify(manualRoutes || []),
            Date.now(),
            function(err) {
              if (err) return reject(err);
              resolve({
                id: this.lastID,
                version: newVersion,
                name: name || `版本 ${newVersion}`
              });
            }
          );
        })
        .catch(reject);
    });
  });
}

function listTopologyVersions() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT id, version, name, created_at 
      FROM topology_versions 
      ORDER BY version DESC
    `, (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(row => ({
        id: row.id,
        version: row.version,
        name: row.name,
        createdAt: row.created_at
      })));
    });
  });
}

function getTopologyVersion(versionId) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT * FROM topology_versions WHERE id = ?
    `, [versionId], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);

      resolve({
        id: row.id,
        version: row.version,
        name: row.name,
        devices: JSON.parse(row.devices),
        links: JSON.parse(row.links),
        manualRoutes: JSON.parse(row.manual_routes),
        createdAt: row.created_at
      });
    });
  });
}

function saveReport(reportData) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO stress_reports (
        scenario_name, aborted, total_duration, total_flows,
        completed_flows, unreachable_flows, avg_loss_rate,
        link_stats, flow_details, raw_samples, topology_snapshot, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      reportData.scenarioName,
      reportData.aborted ? 1 : 0,
      reportData.totalDuration,
      reportData.totalFlows,
      reportData.completedFlows,
      reportData.unreachableFlows,
      reportData.avgLossRate,
      JSON.stringify(reportData.linkStats || []),
      JSON.stringify(reportData.flowDetails || []),
      JSON.stringify(reportData.rawSamples || {}),
      reportData.topologySnapshot ? JSON.stringify(reportData.topologySnapshot) : null,
      reportData.timestamp || Date.now(),
      function(err) {
        if (err) return reject(err);
        resolve({
          id: this.lastID,
          scenarioName: reportData.scenarioName,
          aborted: reportData.aborted,
          totalDuration: reportData.totalDuration,
          totalFlows: reportData.totalFlows,
          timestamp: reportData.timestamp || Date.now()
        });
      }
    );
  });
}

function listReports() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        id, scenario_name, aborted, total_duration, 
        total_flows, completed_flows, avg_loss_rate, timestamp
      FROM stress_reports 
      ORDER BY timestamp DESC
    `, (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(row => ({
        id: row.id,
        scenarioName: row.scenario_name,
        aborted: row.aborted === 1,
        totalDuration: row.total_duration,
        totalFlows: row.total_flows,
        completedFlows: row.completed_flows,
        avgLossRate: row.avg_loss_rate,
        timestamp: row.timestamp
      })));
    });
  });
}

function getReport(reportId) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT * FROM stress_reports WHERE id = ?
    `, [reportId], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);

      resolve({
        id: row.id,
        scenarioName: row.scenario_name,
        aborted: row.aborted === 1,
        totalDuration: row.total_duration,
        totalFlows: row.total_flows,
        completedFlows: row.completed_flows,
        unreachableFlows: row.unreachable_flows,
        avgLossRate: row.avg_loss_rate,
        linkStats: JSON.parse(row.link_stats),
        flowDetails: JSON.parse(row.flow_details),
        rawSamples: JSON.parse(row.raw_samples),
        topologySnapshot: row.topology_snapshot ? JSON.parse(row.topology_snapshot) : null,
        timestamp: row.timestamp
      });
    });
  });
}

async function compareReports(reportId1, reportId2) {
  const report1 = await getReport(reportId1);
  const report2 = await getReport(reportId2);

  if (!report1 || !report2) {
    return null;
  }

  const linkMap1 = new Map();
  report1.linkStats.forEach(ls => {
    linkMap1.set(ls.linkName, ls);
  });

  const linkMap2 = new Map();
  report2.linkStats.forEach(ls => {
    linkMap2.set(ls.linkName, ls);
  });

  const allLinkNames = new Set([...linkMap1.keys(), ...linkMap2.keys()]);

  function getLinkLossRate(ls) {
    if (!ls) return 0;
    if (typeof ls.lossRate === 'number') {
      return ls.lossRate;
    }
    return 0;
  }

  const linkComparisons = [];
  allLinkNames.forEach(linkName => {
    const ls1 = linkMap1.get(linkName);
    const ls2 = linkMap2.get(linkName);

    const peakLoad1 = ls1 ? ls1.peakLoad : 0;
    const peakLoad2 = ls2 ? ls2.peakLoad : 0;
    const peakLoadDiff = peakLoad2 - peakLoad1;

    const avgLossRate1 = getLinkLossRate(ls1);
    const avgLossRate2 = getLinkLossRate(ls2);
    
    const lossRateDiff = avgLossRate2 - avgLossRate1;

    linkComparisons.push({
      linkName,
      report1: {
        peakLoad: peakLoad1,
        avgLossRate: avgLossRate1,
        bandwidth: ls1 ? ls1.bandwidth : null,
        congestedDuration: ls1 ? ls1.congestedDuration : 0
      },
      report2: {
        peakLoad: peakLoad2,
        avgLossRate: avgLossRate2,
        bandwidth: ls2 ? ls2.bandwidth : null,
        congestedDuration: ls2 ? ls2.congestedDuration : 0
      },
      peakLoadDiff,
      peakLoadDiffPercent: peakLoad1 > 0 ? ((peakLoadDiff / peakLoad1) * 100) : (peakLoad2 > 0 ? 100 : 0),
      lossRateDiff,
      existsInBoth: !!ls1 && !!ls2
    });
  });

  linkComparisons.sort((a, b) => Math.abs(b.peakLoadDiff) - Math.abs(a.peakLoadDiff));

  return {
    report1: {
      id: report1.id,
      scenarioName: report1.scenarioName,
      aborted: report1.aborted,
      totalDuration: report1.totalDuration,
      avgLossRate: report1.avgLossRate
    },
    report2: {
      id: report2.id,
      scenarioName: report2.scenarioName,
      aborted: report2.aborted,
      totalDuration: report2.totalDuration,
      avgLossRate: report2.avgLossRate
    },
    overview: {
      durationDiff: report2.totalDuration - report1.totalDuration,
      lossRateDiff: report2.avgLossRate - report1.avgLossRate
    },
    links: linkComparisons
  };
}

function saveDeviceConfig(configData, parsedDevices, parsedLinks) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO device_configs (config_data, parsed_devices, parsed_links, created_at)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      JSON.stringify(configData),
      JSON.stringify(parsedDevices),
      JSON.stringify(parsedLinks),
      Date.now(),
      function(err) {
        if (err) return reject(err);
        resolve({
          id: this.lastID,
          createdAt: Date.now()
        });
      }
    );
  });
}

function listDeviceConfigs() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT id, created_at 
      FROM device_configs 
      ORDER BY created_at DESC
      LIMIT 20
    `, (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(row => ({
        id: row.id,
        createdAt: row.created_at
      })));
    });
  });
}

function getDeviceConfig(configId) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT * FROM device_configs WHERE id = ?
    `, [configId], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);

      resolve({
        id: row.id,
        configData: JSON.parse(row.config_data),
        parsedDevices: JSON.parse(row.parsed_devices),
        parsedLinks: JSON.parse(row.parsed_links),
        createdAt: row.created_at
      });
    });
  });
}

function saveAuditReport(auditData) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO audit_reports (
        total_alerts, critical_count, warning_count, info_count,
        alerts, topology_snapshot, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const alerts = auditData.alerts || [];
    const criticalCount = alerts.filter(a => a.level === 'critical').length;
    const warningCount = alerts.filter(a => a.level === 'warning').length;
    const infoCount = alerts.filter(a => a.level === 'info').length;

    stmt.run(
      alerts.length,
      criticalCount,
      warningCount,
      infoCount,
      JSON.stringify(alerts),
      auditData.topologySnapshot ? JSON.stringify(auditData.topologySnapshot) : null,
      auditData.timestamp || Date.now(),
      function(err) {
        if (err) return reject(err);
        resolve({
          id: this.lastID,
          totalAlerts: alerts.length,
          criticalCount,
          warningCount,
          infoCount,
          timestamp: auditData.timestamp || Date.now()
        });
      }
    );
  });
}

function listAuditReports() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT id, total_alerts, critical_count, warning_count, info_count, timestamp
      FROM audit_reports
      ORDER BY timestamp DESC
      LIMIT 20
    `, (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(row => ({
        id: row.id,
        totalAlerts: row.total_alerts,
        criticalCount: row.critical_count,
        warningCount: row.warning_count,
        infoCount: row.info_count,
        timestamp: row.timestamp
      })));
    });
  });
}

function getAuditReport(reportId) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT * FROM audit_reports WHERE id = ?
    `, [reportId], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);

      resolve({
        id: row.id,
        totalAlerts: row.total_alerts,
        criticalCount: row.critical_count,
        warningCount: row.warning_count,
        infoCount: row.info_count,
        alerts: JSON.parse(row.alerts),
        topologySnapshot: row.topology_snapshot ? JSON.parse(row.topology_snapshot) : null,
        timestamp: row.timestamp
      });
    });
  });
}

async function compareAuditReports(reportId1, reportId2) {
  const report1 = await getAuditReport(reportId1);
  const report2 = await getAuditReport(reportId2);

  if (!report1 || !report2) {
    return null;
  }

  function getAlertKey(alert) {
    return `${alert.rule}:${alert.deviceIds ? alert.deviceIds.join(',') : ''}:${alert.linkIds ? alert.linkIds.join(',') : ''}`;
  }

  const alerts1Map = new Map();
  report1.alerts.forEach(a => alerts1Map.set(getAlertKey(a), a));

  const alerts2Map = new Map();
  report2.alerts.forEach(a => alerts2Map.set(getAlertKey(a), a));

  const allKeys = new Set([...alerts1Map.keys(), ...alerts2Map.keys()]);

  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];

  allKeys.forEach(key => {
    const a1 = alerts1Map.get(key);
    const a2 = alerts2Map.get(key);

    if (!a1 && a2) {
      added.push(a2);
    } else if (a1 && !a2) {
      removed.push(a1);
    } else if (a1 && a2) {
      if (JSON.stringify(a1) !== JSON.stringify(a2)) {
        changed.push({ old: a1, new: a2 });
      } else {
        unchanged.push(a1);
      }
    }
  });

  return {
    report1: {
      id: report1.id,
      totalAlerts: report1.totalAlerts,
      criticalCount: report1.criticalCount,
      warningCount: report1.warningCount,
      infoCount: report1.infoCount,
      timestamp: report1.timestamp
    },
    report2: {
      id: report2.id,
      totalAlerts: report2.totalAlerts,
      criticalCount: report2.criticalCount,
      warningCount: report2.warningCount,
      infoCount: report2.infoCount,
      timestamp: report2.timestamp
    },
    added,
    removed,
    changed,
    unchanged
  };
}

function savePartitionChange(changeData) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO partition_changes (
        old_count, new_count, trigger_link_id, trigger_action,
        trigger_link_name, topology_snapshot, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      changeData.oldCount,
      changeData.newCount,
      changeData.triggerLinkId || null,
      changeData.triggerAction || null,
      changeData.triggerLinkName || null,
      changeData.topologySnapshot ? JSON.stringify(changeData.topologySnapshot) : null,
      changeData.timestamp || Date.now(),
      function(err) {
        if (err) return reject(err);
        resolve({
          id: this.lastID,
          oldCount: changeData.oldCount,
          newCount: changeData.newCount,
          timestamp: changeData.timestamp || Date.now()
        });
      }
    );
  });
}

function listPartitionChanges(limit = 50) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM partition_changes 
      ORDER BY timestamp DESC 
      LIMIT ?
    `, [limit], (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(row => ({
        id: row.id,
        oldCount: row.old_count,
        newCount: row.new_count,
        triggerLinkId: row.trigger_link_id,
        triggerAction: row.trigger_action,
        triggerLinkName: row.trigger_link_name,
        topologySnapshot: row.topology_snapshot ? JSON.parse(row.topology_snapshot) : null,
        timestamp: row.timestamp
      })));
    });
  });
}

module.exports = {
  initDatabase,
  saveTopology,
  listTopologyVersions,
  getTopologyVersion,
  saveReport,
  listReports,
  getReport,
  compareReports,
  saveDeviceConfig,
  listDeviceConfigs,
  getDeviceConfig,
  saveAuditReport,
  listAuditReports,
  getAuditReport,
  compareAuditReports,
  savePartitionChange,
  listPartitionChanges
};
