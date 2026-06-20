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
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS traffic_recordings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          duration REAL NOT NULL,
          sample_count INTEGER NOT NULL,
          event_count INTEGER NOT NULL,
          link_samples TEXT NOT NULL,
          events TEXT NOT NULL,
          topology_snapshot TEXT,
          created_at INTEGER NOT NULL
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_traffic_recordings_created 
        ON traffic_recordings(created_at DESC)
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS sla_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          contract_name TEXT NOT NULL,
          event_type TEXT NOT NULL,
          breach_types TEXT NOT NULL,
          root_cause_link TEXT,
          duration REAL NOT NULL DEFAULT 0,
          timestamp INTEGER NOT NULL
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_sla_events_timestamp 
        ON sla_events(timestamp DESC)
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_sla_events_contract_name 
        ON sla_events(contract_name)
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS migration_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          description TEXT,
          total_batches INTEGER NOT NULL DEFAULT 0,
          completed_batches INTEGER NOT NULL DEFAULT 0,
          total_flows INTEGER NOT NULL DEFAULT 0,
          preview_result TEXT,
          final_result TEXT,
          pre_migration_snapshot TEXT,
          post_migration_snapshot TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          started_at INTEGER,
          finished_at INTEGER
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS migration_batches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL,
          batch_number INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          flow_count INTEGER NOT NULL DEFAULT 0,
          preview_result TEXT,
          execution_result TEXT,
          scheduled_at INTEGER,
          started_at INTEGER,
          completed_at INTEGER,
          FOREIGN KEY (task_id) REFERENCES migration_tasks(id) ON DELETE CASCADE
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS migration_flows (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL,
          batch_id INTEGER,
          flow_id INTEGER NOT NULL,
          src_id INTEGER NOT NULL,
          dst_id INTEGER NOT NULL,
          src_name TEXT,
          dst_name TEXT,
          rate REAL NOT NULL,
          priority TEXT NOT NULL DEFAULT 'normal',
          target_type TEXT NOT NULL DEFAULT 'path',
          target_path TEXT,
          target_next_hop INTEGER,
          target_next_hop_name TEXT,
          original_path TEXT,
          original_next_hop INTEGER,
          status TEXT NOT NULL DEFAULT 'pending',
          sla_contract_name TEXT,
          FOREIGN KEY (task_id) REFERENCES migration_tasks(id) ON DELETE CASCADE,
          FOREIGN KEY (batch_id) REFERENCES migration_batches(id) ON DELETE SET NULL
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_migration_tasks_created 
        ON migration_tasks(created_at DESC)
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_migration_batches_task_id 
        ON migration_batches(task_id)
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_migration_flows_task_id 
        ON migration_flows(task_id)
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS fault_playbooks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          event_count INTEGER NOT NULL DEFAULT 0,
          total_duration REAL NOT NULL DEFAULT 0,
          events TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_fault_playbooks_created 
        ON fault_playbooks(created_at DESC)
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS resilience_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          playbook_id INTEGER,
          playbook_name TEXT NOT NULL,
          status TEXT NOT NULL,
          total_duration REAL NOT NULL,
          total_events INTEGER NOT NULL,
          triggered_events INTEGER NOT NULL,
          max_partition_count INTEGER NOT NULL,
          longest_disconnect_duration REAL NOT NULL,
          total_disconnect_duration REAL NOT NULL,
          link_resilience_ranking TEXT NOT NULL,
          timeline_samples TEXT NOT NULL,
          recovery_speeds TEXT NOT NULL,
          sla_breach_count INTEGER NOT NULL DEFAULT 0,
          paused_flow_count INTEGER NOT NULL DEFAULT 0,
          unreachable_pair_count INTEGER NOT NULL DEFAULT 0,
          pre_topology_snapshot TEXT,
          post_topology_snapshot TEXT,
          timestamp INTEGER NOT NULL
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_resilience_reports_timestamp 
        ON resilience_reports(timestamp DESC)
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

const MAX_TRAFFIC_RECORDINGS = 10;

function saveTrafficRecording(recordingData) {
  return new Promise((resolve, reject) => {
    const { name, duration, sampleCount, eventCount, linkSamples, events, topologySnapshot } = recordingData;

    db.get('SELECT COUNT(*) as count FROM traffic_recordings', (err, countRow) => {
      if (err) return reject(err);

      const currentCount = countRow.count;

      const deleteOldIfNeeded = () => {
        return new Promise((res, rej) => {
          if (currentCount >= MAX_TRAFFIC_RECORDINGS) {
            const toDelete = currentCount - MAX_TRAFFIC_RECORDINGS + 1;
            db.run(`
              DELETE FROM traffic_recordings 
              WHERE id IN (
                SELECT id FROM traffic_recordings 
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

      deleteOldIfNeeded()
        .then(() => {
          const stmt = db.prepare(`
            INSERT INTO traffic_recordings 
              (name, duration, sample_count, event_count, link_samples, events, topology_snapshot, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);

          stmt.run(
            name || `录制 ${new Date().toLocaleString()}`,
            duration || 0,
            sampleCount || 0,
            eventCount || 0,
            JSON.stringify(linkSamples || {}),
            JSON.stringify(events || []),
            topologySnapshot ? JSON.stringify(topologySnapshot) : null,
            Date.now(),
            function(err) {
              if (err) return reject(err);
              resolve({
                id: this.lastID,
                name: name || `录制 ${new Date().toLocaleString()}`,
                duration,
                sampleCount,
                eventCount,
                createdAt: Date.now()
              });
            }
          );
        })
        .catch(reject);
    });
  });
}

function listTrafficRecordings() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT id, name, duration, sample_count, event_count, created_at 
      FROM traffic_recordings 
      ORDER BY created_at DESC
    `, (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(row => ({
        id: row.id,
        name: row.name,
        duration: row.duration,
        sampleCount: row.sample_count,
        eventCount: row.event_count,
        createdAt: row.created_at
      })));
    });
  });
}

function getTrafficRecording(recordingId) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT * FROM traffic_recordings WHERE id = ?
    `, [recordingId], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);

      resolve({
        id: row.id,
        name: row.name,
        duration: row.duration,
        sampleCount: row.sample_count,
        eventCount: row.event_count,
        linkSamples: JSON.parse(row.link_samples),
        events: JSON.parse(row.events),
        topologySnapshot: row.topology_snapshot ? JSON.parse(row.topology_snapshot) : null,
        createdAt: row.created_at
      });
    });
  });
}

function deleteTrafficRecording(recordingId) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM traffic_recordings WHERE id = ?', [recordingId], (err) => {
      if (err) return reject(err);
      resolve({ success: true });
    });
  });
}

async function compareTrafficRecordings(recordingId1, recordingId2) {
  const rec1 = await getTrafficRecording(recordingId1);
  const rec2 = await getTrafficRecording(recordingId2);

  if (!rec1 || !rec2) {
    return null;
  }

  const linkSamples1 = rec1.linkSamples || {};
  const linkSamples2 = rec2.linkSamples || {};

  function buildLinkKey(fromId, toId) {
    return `${fromId}-${toId}`;
  }

  function getLinkDisplayName(fromId, toId) {
    const snap = rec1.topologySnapshot || rec2.topologySnapshot;
    if (snap && snap.devices) {
      const fromDev = snap.devices.find(d => d.id === fromId || d.id === parseInt(fromId));
      const toDev = snap.devices.find(d => d.id === toId || d.id === parseInt(toId));
      if (fromDev && toDev) {
        return `${fromDev.name} - ${toDev.name}`;
      }
    }
    return `Link ${fromId}-${toId}`;
  }

  function getLinkBandwidth(linkKey) {
    const snap = rec1.topologySnapshot || rec2.topologySnapshot;
    if (snap && snap.links) {
      const [fromId, toId] = linkKey.split('-').map(Number);
      const link = snap.links.find(l =>
        (l.from === fromId && l.to === toId) ||
        (l.from === toId && l.to === fromId)
      );
      return link ? link.bandwidth : null;
    }
    return null;
  }

  function analyzeSamples(samples) {
    if (!samples || samples.length === 0) {
      return { avgLoad: 0, peakLoad: 0, congestionDuration: 0 };
    }
    const loads = samples.map(s => s.load || 0);
    const avgLoad = loads.reduce((a, b) => a + b, 0) / loads.length;
    const peakLoad = Math.max(...loads);
    const congestedSamples = loads.filter(l => l > 0.85).length;
    const congestionDuration = congestedSamples * 0.2;
    return { avgLoad, peakLoad, congestionDuration };
  }

  const allLinkKeys = new Set([
    ...Object.keys(linkSamples1),
    ...Object.keys(linkSamples2)
  ]);

  const linkComparisons = [];

  allLinkKeys.forEach(linkKey => {
    const samples1 = linkSamples1[linkKey] || [];
    const samples2 = linkSamples2[linkKey] || [];

    const stats1 = analyzeSamples(samples1);
    const stats2 = analyzeSamples(samples2);

    const avgLoadDiff = stats2.avgLoad - stats1.avgLoad;
    const peakLoadDiff = stats2.peakLoad - stats1.peakLoad;
    const congestionDurationDiff = stats2.congestionDuration - stats1.congestionDuration;
    const totalDiff = Math.abs(avgLoadDiff) * 2 + Math.abs(peakLoadDiff) + Math.abs(congestionDurationDiff) * 0.5;

    const [fromId, toId] = linkKey.split('-');

    linkComparisons.push({
      linkKey,
      linkName: getLinkDisplayName(fromId, toId),
      bandwidth: getLinkBandwidth(linkKey),
      recording1: {
        avgLoad: stats1.avgLoad,
        peakLoad: stats1.peakLoad,
        congestionDuration: stats1.congestionDuration
      },
      recording2: {
        avgLoad: stats2.avgLoad,
        peakLoad: stats2.peakLoad,
        congestionDuration: stats2.congestionDuration
      },
      avgLoadDiff,
      peakLoadDiff,
      congestionDurationDiff,
      totalDiff,
      existsInBoth: samples1.length > 0 && samples2.length > 0
    });
  });

  linkComparisons.sort((a, b) => b.totalDiff - a.totalDiff);

  return {
    recording1: {
      id: rec1.id,
      name: rec1.name,
      duration: rec1.duration,
      sampleCount: rec1.sampleCount,
      eventCount: rec1.eventCount,
      createdAt: rec1.createdAt
    },
    recording2: {
      id: rec2.id,
      name: rec2.name,
      duration: rec2.duration,
      sampleCount: rec2.sampleCount,
      eventCount: rec2.eventCount,
      createdAt: rec2.createdAt
    },
    links: linkComparisons.slice(0, 50)
  };
}

const MAX_MIGRATION_TASKS = 30;

function saveMigrationTask(taskData) {
  return new Promise((resolve, reject) => {
    const { name, description, batches, flows, previewResult, preMigrationSnapshot } = taskData;
    const now = Date.now();

    db.get('SELECT COUNT(*) as count FROM migration_tasks', (err, countRow) => {
      if (err) return reject(err);

      const currentCount = countRow.count;

      const deleteOldIfNeeded = () => {
        return new Promise((res, rej) => {
          if (currentCount >= MAX_MIGRATION_TASKS) {
            const toDelete = currentCount - MAX_MIGRATION_TASKS + 1;
            db.run(`
              DELETE FROM migration_tasks 
              WHERE id IN (
                SELECT id FROM migration_tasks 
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

      deleteOldIfNeeded()
        .then(() => {
          const stmt = db.prepare(`
            INSERT INTO migration_tasks (
              name, status, description, total_batches, total_flows,
              preview_result, pre_migration_snapshot, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          stmt.run(
            name,
            'draft',
            description || null,
            batches ? batches.length : 0,
            flows ? flows.length : 0,
            previewResult ? JSON.stringify(previewResult) : null,
            preMigrationSnapshot ? JSON.stringify(preMigrationSnapshot) : null,
            now,
            now,
            function(err) {
              if (err) return reject(err);
              const taskId = this.lastID;

              const saveBatchesAndFlows = async () => {
                if (batches && batches.length > 0) {
                  for (let i = 0; i < batches.length; i++) {
                    const batch = batches[i];
                    const batchId = await saveBatchInternal(taskId, batch, i + 1);
                    if (batch.flows && batch.flows.length > 0) {
                      for (const flow of batch.flows) {
                        await saveFlowInternal(taskId, batchId, flow);
                      }
                    }
                  }
                } else if (flows && flows.length > 0) {
                  for (const flow of flows) {
                    await saveFlowInternal(taskId, null, flow);
                  }
                }
              };

              saveBatchesAndFlows()
                .then(() => {
                  resolve({
                    id: taskId,
                    name,
                    status: 'draft',
                    createdAt: now
                  });
                })
                .catch(reject);
            }
          );
        })
        .catch(reject);
    });
  });
}

function saveBatchInternal(taskId, batch, batchNumber) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO migration_batches (
        task_id, batch_number, status, flow_count, preview_result, scheduled_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      taskId,
      batchNumber,
      batch.status || 'pending',
      batch.flows ? batch.flows.length : 0,
      batch.previewResult ? JSON.stringify(batch.previewResult) : null,
      batch.scheduledAt || null,
      function(err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

function saveFlowInternal(taskId, batchId, flow) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO migration_flows (
        task_id, batch_id, flow_id, src_id, dst_id, src_name, dst_name,
        rate, priority, target_type, target_path, target_next_hop,
        target_next_hop_name, original_path, original_next_hop,
        status, sla_contract_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      taskId,
      batchId || null,
      flow.flowId || flow.id || 0,
      flow.srcId || flow.src_id || 0,
      flow.dstId || flow.dst_id || 0,
      flow.srcName || flow.src_name || null,
      flow.dstName || flow.dst_name || null,
      flow.rate || 0,
      flow.priority || 'normal',
      flow.targetType || flow.target_type || 'path',
      flow.targetPath ? JSON.stringify(flow.targetPath) : (flow.target_path ? flow.target_path : null),
      flow.targetNextHop || flow.target_next_hop || null,
      flow.targetNextHopName || flow.target_next_hop_name || null,
      flow.originalPath ? JSON.stringify(flow.originalPath) : (flow.original_path ? flow.original_path : null),
      flow.originalNextHop || flow.original_next_hop || null,
      flow.status || 'pending',
      flow.slaContractName || flow.sla_contract_name || null,
      function(err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

function listMigrationTasks() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT id, name, status, description, total_batches, completed_batches, 
             total_flows, created_at, updated_at, started_at, finished_at
      FROM migration_tasks 
      ORDER BY created_at DESC
      LIMIT ?
    `, [MAX_MIGRATION_TASKS], (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(row => ({
        id: row.id,
        name: row.name,
        status: row.status,
        description: row.description,
        totalBatches: row.total_batches,
        completedBatches: row.completed_batches,
        totalFlows: row.total_flows,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at
      })));
    });
  });
}

function getMigrationTask(taskId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM migration_tasks WHERE id = ?`, [taskId], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);

      const task = {
        id: row.id,
        name: row.name,
        status: row.status,
        description: row.description,
        totalBatches: row.total_batches,
        completedBatches: row.completed_batches,
        totalFlows: row.total_flows,
        previewResult: row.preview_result ? JSON.parse(row.preview_result) : null,
        finalResult: row.final_result ? JSON.parse(row.final_result) : null,
        preMigrationSnapshot: row.pre_migration_snapshot ? JSON.parse(row.pre_migration_snapshot) : null,
        postMigrationSnapshot: row.post_migration_snapshot ? JSON.parse(row.post_migration_snapshot) : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at
      };

      db.all(`SELECT * FROM migration_batches WHERE task_id = ? ORDER BY batch_number`, [taskId], (err, batchRows) => {
        if (err) return reject(err);

        task.batches = batchRows.map(bRow => ({
          id: bRow.id,
          batchNumber: bRow.batch_number,
          status: bRow.status,
          flowCount: bRow.flow_count,
          previewResult: bRow.preview_result ? JSON.parse(bRow.preview_result) : null,
          executionResult: bRow.execution_result ? JSON.parse(bRow.execution_result) : null,
          scheduledAt: bRow.scheduled_at,
          startedAt: bRow.started_at,
          completedAt: bRow.completed_at
        }));

        db.all(`SELECT * FROM migration_flows WHERE task_id = ? ORDER BY id`, [taskId], (err, flowRows) => {
          if (err) return reject(err);

          task.flows = flowRows.map(fRow => ({
            id: fRow.id,
            batchId: fRow.batch_id,
            flowId: fRow.flow_id,
            srcId: fRow.src_id,
            dstId: fRow.dst_id,
            srcName: fRow.src_name,
            dstName: fRow.dst_name,
            rate: fRow.rate,
            priority: fRow.priority,
            targetType: fRow.target_type,
            targetPath: fRow.target_path ? JSON.parse(fRow.target_path) : null,
            targetNextHop: fRow.target_next_hop,
            targetNextHopName: fRow.target_next_hop_name,
            originalPath: fRow.original_path ? JSON.parse(fRow.original_path) : null,
            originalNextHop: fRow.original_next_hop,
            status: fRow.status,
            slaContractName: fRow.sla_contract_name
          }));

          resolve(task);
        });
      });
    });
  });
}

function updateMigrationTask(taskId, updates) {
  return new Promise((resolve, reject) => {
    const setClauses = [];
    const params = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      params.push(updates.name);
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      params.push(updates.status);
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      params.push(updates.description);
    }
    if (updates.completedBatches !== undefined) {
      setClauses.push('completed_batches = ?');
      params.push(updates.completedBatches);
    }
    if (updates.previewResult !== undefined) {
      setClauses.push('preview_result = ?');
      params.push(JSON.stringify(updates.previewResult));
    }
    if (updates.finalResult !== undefined) {
      setClauses.push('final_result = ?');
      params.push(JSON.stringify(updates.finalResult));
    }
    if (updates.preMigrationSnapshot !== undefined) {
      setClauses.push('pre_migration_snapshot = ?');
      params.push(JSON.stringify(updates.preMigrationSnapshot));
    }
    if (updates.postMigrationSnapshot !== undefined) {
      setClauses.push('post_migration_snapshot = ?');
      params.push(JSON.stringify(updates.postMigrationSnapshot));
    }
    if (updates.startedAt !== undefined) {
      setClauses.push('started_at = ?');
      params.push(updates.startedAt);
    }
    if (updates.finishedAt !== undefined) {
      setClauses.push('finished_at = ?');
      params.push(updates.finishedAt);
    }

    if (setClauses.length === 0) {
      return resolve(null);
    }

    setClauses.push('updated_at = ?');
    params.push(Date.now());
    params.push(taskId);

    const sql = `UPDATE migration_tasks SET ${setClauses.join(', ')} WHERE id = ?`;
    db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve({ changed: this.changes > 0 });
    });
  });
}

function updateMigrationBatch(batchId, updates) {
  return new Promise((resolve, reject) => {
    const setClauses = [];
    const params = [];

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      params.push(updates.status);
    }
    if (updates.executionResult !== undefined) {
      setClauses.push('execution_result = ?');
      params.push(JSON.stringify(updates.executionResult));
    }
    if (updates.previewResult !== undefined) {
      setClauses.push('preview_result = ?');
      params.push(JSON.stringify(updates.previewResult));
    }
    if (updates.startedAt !== undefined) {
      setClauses.push('started_at = ?');
      params.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      setClauses.push('completed_at = ?');
      params.push(updates.completedAt);
    }

    if (setClauses.length === 0) {
      return resolve(null);
    }

    params.push(batchId);
    const sql = `UPDATE migration_batches SET ${setClauses.join(', ')} WHERE id = ?`;
    db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve({ changed: this.changes > 0 });
    });
  });
}

function updateMigrationFlow(flowId, updates) {
  return new Promise((resolve, reject) => {
    const setClauses = [];
    const params = [];

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      params.push(updates.status);
    }
    if (updates.batchId !== undefined) {
      setClauses.push('batch_id = ?');
      params.push(updates.batchId);
    }

    if (setClauses.length === 0) {
      return resolve(null);
    }

    params.push(flowId);
    const sql = `UPDATE migration_flows SET ${setClauses.join(', ')} WHERE id = ?`;
    db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve({ changed: this.changes > 0 });
    });
  });
}

function deleteMigrationTask(taskId) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM migration_tasks WHERE id = ?', [taskId], function(err) {
      if (err) return reject(err);
      resolve({ deleted: this.changes });
    });
  });
}

function duplicateMigrationTask(taskId, newName) {
  return new Promise((resolve, reject) => {
    getMigrationTask(taskId).then(original => {
      if (!original) return resolve(null);

      const now = Date.now();
      const stmt = db.prepare(`
        INSERT INTO migration_tasks (
          name, status, description, total_batches, completed_batches,
          total_flows, preview_result, pre_migration_snapshot, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        newName || original.name + ' (副本)',
        'draft',
        original.description,
        original.totalBatches,
        0,
        original.totalFlows,
        null,
        null,
        now,
        now,
        function(err) {
          if (err) return reject(err);
          const newTaskId = this.lastID;

          const copyBatches = async () => {
            const batchIdMap = new Map();
            if (original.batches && original.batches.length > 0) {
              for (const batch of original.batches) {
                const newBatchId = await saveBatchInternal(newTaskId, {
                  status: 'pending',
                  previewResult: null
                }, batch.batchNumber);
                batchIdMap.set(batch.id, newBatchId);
              }
            }

            if (original.flows && original.flows.length > 0) {
              for (const flow of original.flows) {
                const newBatchId = flow.batchId ? batchIdMap.get(flow.batchId) : null;
                await saveFlowInternal(newTaskId, newBatchId, {
                  ...flow,
                  status: 'pending'
                });
              }
            }
          };

          copyBatches()
            .then(() => {
              resolve({
                id: newTaskId,
                name: newName || original.name + ' (副本)',
                createdAt: now
              });
            })
            .catch(reject);
        }
      );
    }).catch(reject);
  });
}

function saveSlaEvent(eventData) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO sla_events (contract_name, event_type, breach_types, root_cause_link, duration, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      eventData.contractName,
      eventData.eventType,
      JSON.stringify(eventData.breachTypes || []),
      eventData.rootCauseLink || null,
      eventData.duration || 0,
      eventData.timestamp || Date.now(),
      function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, timestamp: eventData.timestamp || Date.now() });
      }
    );
  });
}

function listSlaEvents(filters) {
  return new Promise((resolve, reject) => {
    let sql = 'SELECT * FROM sla_events WHERE 1=1';
    const params = [];

    if (filters.contractName) {
      sql += ' AND contract_name = ?';
      params.push(filters.contractName);
    }
    if (filters.startTime) {
      sql += ' AND timestamp >= ?';
      params.push(parseInt(filters.startTime));
    }
    if (filters.endTime) {
      sql += ' AND timestamp <= ?';
      params.push(parseInt(filters.endTime));
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(parseInt(filters.limit) || 100);

    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(row => ({
        id: row.id,
        contractName: row.contract_name,
        eventType: row.event_type,
        breachTypes: JSON.parse(row.breach_types),
        rootCauseLink: row.root_cause_link,
        duration: row.duration,
        timestamp: row.timestamp
      })));
    });
  });
}

const MAX_FAULT_PLAYBOOKS = 5;

function saveFaultPlaybook(playbookData) {
  return new Promise((resolve, reject) => {
    const { id, name, description, events } = playbookData;
    const now = Date.now();

    const eventCount = events ? events.length : 0;
    const totalDuration = events && events.length > 0 
      ? Math.max(...events.map(e => e.time || 0)) 
      : 0;

    if (id) {
      const stmt = db.prepare(`
        UPDATE fault_playbooks 
        SET name = ?, description = ?, event_count = ?, total_duration = ?, events = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(
        name,
        description || null,
        eventCount,
        totalDuration,
        JSON.stringify(events || []),
        now,
        id,
        function(err) {
          if (err) return reject(err);
          resolve({
            id,
            name,
            description,
            eventCount,
            totalDuration,
            updatedAt: now
          });
        }
      );
    } else {
      db.get('SELECT COUNT(*) as count FROM fault_playbooks', (err, countRow) => {
        if (err) return reject(err);

        const currentCount = countRow.count;

        const deleteOldIfNeeded = () => {
          return new Promise((res, rej) => {
            if (currentCount >= MAX_FAULT_PLAYBOOKS) {
              const toDelete = currentCount - MAX_FAULT_PLAYBOOKS + 1;
              db.run(`
                DELETE FROM fault_playbooks 
                WHERE id IN (
                  SELECT id FROM fault_playbooks 
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

        deleteOldIfNeeded()
          .then(() => {
            const stmt = db.prepare(`
              INSERT INTO fault_playbooks 
                (name, description, event_count, total_duration, events, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(
              name,
              description || null,
              eventCount,
              totalDuration,
              JSON.stringify(events || []),
              now,
              now,
              function(err) {
                if (err) return reject(err);
                resolve({
                  id: this.lastID,
                  name,
                  description,
                  eventCount,
                  totalDuration,
                  createdAt: now,
                  updatedAt: now
                });
              }
            );
          })
          .catch(reject);
      });
    }
  });
}

function listFaultPlaybooks() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT id, name, description, event_count, total_duration, created_at, updated_at
      FROM fault_playbooks 
      ORDER BY created_at DESC
    `, (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        eventCount: row.event_count,
        totalDuration: row.total_duration,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })));
    });
  });
}

function getFaultPlaybook(playbookId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM fault_playbooks WHERE id = ?`, [playbookId], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);

      resolve({
        id: row.id,
        name: row.name,
        description: row.description,
        eventCount: row.event_count,
        totalDuration: row.total_duration,
        events: JSON.parse(row.events),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });
    });
  });
}

function deleteFaultPlaybook(playbookId) {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM fault_playbooks WHERE id = ?', [playbookId], function(err) {
      if (err) return reject(err);
      resolve({ deleted: this.changes });
    });
  });
}

function saveResilienceReport(reportData) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO resilience_reports (
        playbook_id, playbook_name, status, total_duration, total_events,
        triggered_events, max_partition_count, longest_disconnect_duration,
        total_disconnect_duration, link_resilience_ranking, timeline_samples,
        recovery_speeds, sla_breach_count, paused_flow_count,
        unreachable_pair_count, pre_topology_snapshot, post_topology_snapshot, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      reportData.playbookId || null,
      reportData.playbookName,
      reportData.status || 'completed',
      reportData.totalDuration || 0,
      reportData.totalEvents || 0,
      reportData.triggeredEvents || 0,
      reportData.maxPartitionCount || 1,
      reportData.longestDisconnectDuration || 0,
      reportData.totalDisconnectDuration || 0,
      JSON.stringify(reportData.linkResilienceRanking || []),
      JSON.stringify(reportData.timelineSamples || []),
      JSON.stringify(reportData.recoverySpeeds || []),
      reportData.slaBreachCount || 0,
      reportData.pausedFlowCount || 0,
      reportData.unreachablePairCount || 0,
      reportData.preTopologySnapshot ? JSON.stringify(reportData.preTopologySnapshot) : null,
      reportData.postTopologySnapshot ? JSON.stringify(reportData.postTopologySnapshot) : null,
      reportData.timestamp || Date.now(),
      function(err) {
        if (err) return reject(err);
        resolve({
          id: this.lastID,
          playbookName: reportData.playbookName,
          status: reportData.status,
          totalDuration: reportData.totalDuration,
          timestamp: reportData.timestamp || Date.now()
        });
      }
    );
  });
}

function listResilienceReports() {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT 
        id, playbook_id, playbook_name, status, total_duration, 
        total_events, triggered_events, max_partition_count,
        sla_breach_count, timestamp
      FROM resilience_reports 
      ORDER BY timestamp DESC
      LIMIT 30
    `, (err, rows) => {
      if (err) return reject(err);
      resolve(rows.map(row => ({
        id: row.id,
        playbookId: row.playbook_id,
        playbookName: row.playbook_name,
        status: row.status,
        totalDuration: row.total_duration,
        totalEvents: row.total_events,
        triggeredEvents: row.triggered_events,
        maxPartitionCount: row.max_partition_count,
        slaBreachCount: row.sla_breach_count,
        timestamp: row.timestamp
      })));
    });
  });
}

function getResilienceReport(reportId) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM resilience_reports WHERE id = ?`, [reportId], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(null);

      resolve({
        id: row.id,
        playbookId: row.playbook_id,
        playbookName: row.playbook_name,
        status: row.status,
        totalDuration: row.total_duration,
        totalEvents: row.total_events,
        triggeredEvents: row.triggered_events,
        maxPartitionCount: row.max_partition_count,
        longestDisconnectDuration: row.longest_disconnect_duration,
        totalDisconnectDuration: row.total_disconnect_duration,
        linkResilienceRanking: JSON.parse(row.link_resilience_ranking),
        timelineSamples: JSON.parse(row.timeline_samples),
        recoverySpeeds: JSON.parse(row.recovery_speeds),
        slaBreachCount: row.sla_breach_count,
        pausedFlowCount: row.paused_flow_count,
        unreachablePairCount: row.unreachable_pair_count,
        preTopologySnapshot: row.pre_topology_snapshot ? JSON.parse(row.pre_topology_snapshot) : null,
        postTopologySnapshot: row.post_topology_snapshot ? JSON.parse(row.post_topology_snapshot) : null,
        timestamp: row.timestamp
      });
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
  listPartitionChanges,
  saveTrafficRecording,
  listTrafficRecordings,
  getTrafficRecording,
  deleteTrafficRecording,
  compareTrafficRecordings,
  saveSlaEvent,
  listSlaEvents,
  saveMigrationTask,
  listMigrationTasks,
  getMigrationTask,
  updateMigrationTask,
  updateMigrationBatch,
  updateMigrationFlow,
  deleteMigrationTask,
  duplicateMigrationTask,
  saveFaultPlaybook,
  listFaultPlaybooks,
  getFaultPlaybook,
  deleteFaultPlaybook,
  saveResilienceReport,
  listResilienceReports,
  getResilienceReport
};
