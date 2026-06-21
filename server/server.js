const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const {
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
  getResilienceReport,
  saveCapacitySimulation,
  listCapacitySimulations,
  getCapacitySimulation,
  saveChangeImpactHistory,
  listChangeImpactHistory,
  getChangeImpactHistory
} = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const clientPath = path.join(__dirname, '..', 'client');
if (fs.existsSync(clientPath)) {
  app.use(express.static(clientPath));
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.post('/api/topology', async (req, res) => {
  try {
    const { devices, links, manualRoutes, name } = req.body;

    if (!devices || !links) {
      return res.status(400).json({ error: '缺少必要字段: devices, links' });
    }

    const result = await saveTopology({
      devices,
      links,
      manualRoutes: manualRoutes || [],
      name
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('保存拓扑失败:', err);
    res.status(500).json({ error: '保存失败' });
  }
});

app.get('/api/topology/versions', async (req, res) => {
  try {
    const versions = await listTopologyVersions();
    res.json({
      success: true,
      data: versions
    });
  } catch (err) {
    console.error('获取版本列表失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.get('/api/topology/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的版本ID' });
    }

    const topology = await getTopologyVersion(id);
    if (!topology) {
      return res.status(404).json({ error: '版本不存在' });
    }

    res.json({
      success: true,
      data: topology
    });
  } catch (err) {
    console.error('获取拓扑失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.post('/api/reports', async (req, res) => {
  try {
    const reportData = req.body;

    if (!reportData.scenarioName) {
      return res.status(400).json({ error: '缺少场景名称' });
    }

    const result = await saveReport(reportData);

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('保存报告失败:', err);
    res.status(500).json({ error: '保存失败' });
  }
});

app.get('/api/reports', async (req, res) => {
  try {
    const reports = await listReports();
    res.json({
      success: true,
      data: reports
    });
  } catch (err) {
    console.error('获取报告列表失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.get('/api/reports/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的报告ID' });
    }

    const report = await getReport(id);
    if (!report) {
      return res.status(404).json({ error: '报告不存在' });
    }

    res.json({
      success: true,
      data: report
    });
  } catch (err) {
    console.error('获取报告失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.get('/api/reports/compare/:id1/:id2', async (req, res) => {
  try {
    const id1 = parseInt(req.params.id1);
    const id2 = parseInt(req.params.id2);

    if (isNaN(id1) || isNaN(id2)) {
      return res.status(400).json({ error: '无效的报告ID' });
    }

    const result = await compareReports(id1, id2);
    if (!result) {
      return res.status(404).json({ error: '报告不存在' });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('对比报告失败:', err);
    res.status(500).json({ error: '对比失败' });
  }
});

app.post('/api/configs', async (req, res) => {
  try {
    const { configData, parsedDevices, parsedLinks } = req.body;

    if (!configData || !parsedDevices || !parsedLinks) {
      return res.status(400).json({ error: '缺少必要字段: configData, parsedDevices, parsedLinks' });
    }

    const result = await saveDeviceConfig(configData, parsedDevices, parsedLinks);

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('保存配置失败:', err);
    res.status(500).json({ error: '保存失败' });
  }
});

app.get('/api/configs', async (req, res) => {
  try {
    const configs = await listDeviceConfigs();
    res.json({
      success: true,
      data: configs
    });
  } catch (err) {
    console.error('获取配置列表失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.get('/api/configs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的配置ID' });
    }

    const config = await getDeviceConfig(id);
    if (!config) {
      return res.status(404).json({ error: '配置不存在' });
    }

    res.json({
      success: true,
      data: config
    });
  } catch (err) {
    console.error('获取配置失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.post('/api/audits', async (req, res) => {
  try {
    const auditData = req.body;

    if (!auditData.alerts) {
      return res.status(400).json({ error: '缺少审计告警数据' });
    }

    const result = await saveAuditReport(auditData);

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('保存审计报告失败:', err);
    res.status(500).json({ error: '保存失败' });
  }
});

app.get('/api/audits', async (req, res) => {
  try {
    const audits = await listAuditReports();
    res.json({
      success: true,
      data: audits
    });
  } catch (err) {
    console.error('获取审计列表失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.get('/api/audits/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的审计ID' });
    }

    const audit = await getAuditReport(id);
    if (!audit) {
      return res.status(404).json({ error: '审计报告不存在' });
    }

    res.json({
      success: true,
      data: audit
    });
  } catch (err) {
    console.error('获取审计报告失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.get('/api/audits/compare/:id1/:id2', async (req, res) => {
  try {
    const id1 = parseInt(req.params.id1);
    const id2 = parseInt(req.params.id2);

    if (isNaN(id1) || isNaN(id2)) {
      return res.status(400).json({ error: '无效的审计ID' });
    }

    const result = await compareAuditReports(id1, id2);
    if (!result) {
      return res.status(404).json({ error: '审计报告不存在' });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('对比审计报告失败:', err);
    res.status(500).json({ error: '对比失败' });
  }
});

app.post('/api/partitions/changes', async (req, res) => {
  try {
    const changeData = req.body;

    if (changeData.oldCount === undefined || changeData.newCount === undefined) {
      return res.status(400).json({ error: '缺少必要字段: oldCount, newCount' });
    }

    const result = await savePartitionChange(changeData);

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('保存分区变更失败:', err);
    res.status(500).json({ error: '保存失败' });
  }
});

app.get('/api/partitions/changes', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const changes = await listPartitionChanges(limit);
    res.json({
      success: true,
      data: changes
    });
  } catch (err) {
    console.error('获取分区变更历史失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.post('/api/recordings', async (req, res) => {
  try {
    const recordingData = req.body;

    if (!recordingData.linkSamples || !recordingData.events) {
      return res.status(400).json({ error: '缺少必要字段: linkSamples, events' });
    }

    const result = await saveTrafficRecording(recordingData);

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('保存流量录制失败:', err);
    res.status(500).json({ error: '保存失败' });
  }
});

app.get('/api/recordings', async (req, res) => {
  try {
    const recordings = await listTrafficRecordings();
    res.json({
      success: true,
      data: recordings
    });
  } catch (err) {
    console.error('获取录制列表失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.get('/api/recordings/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的录制ID' });
    }

    const recording = await getTrafficRecording(id);
    if (!recording) {
      return res.status(404).json({ error: '录制不存在' });
    }

    res.json({
      success: true,
      data: recording
    });
  } catch (err) {
    console.error('获取流量录制失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.delete('/api/recordings/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的录制ID' });
    }

    await deleteTrafficRecording(id);

    res.json({
      success: true
    });
  } catch (err) {
    console.error('删除流量录制失败:', err);
    res.status(500).json({ error: '删除失败' });
  }
});

app.get('/api/recordings/compare/:id1/:id2', async (req, res) => {
  try {
    const id1 = parseInt(req.params.id1);
    const id2 = parseInt(req.params.id2);

    if (isNaN(id1) || isNaN(id2)) {
      return res.status(400).json({ error: '无效的录制ID' });
    }

    const result = await compareTrafficRecordings(id1, id2);
    if (!result) {
      return res.status(404).json({ error: '录制不存在' });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('对比流量录制失败:', err);
    res.status(500).json({ error: '对比失败' });
  }
});

app.post('/api/sla/events', async (req, res) => {
  try {
    const eventData = req.body;

    if (!eventData.contractName || !eventData.eventType) {
      return res.status(400).json({ error: '缺少必要字段: contractName, eventType' });
    }

    const result = await saveSlaEvent(eventData);

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('保存SLA事件失败:', err);
    res.status(500).json({ error: '保存失败' });
  }
});

app.get('/api/sla/events', async (req, res) => {
  try {
    const filters = {
      contractName: req.query.contractName || null,
      startTime: req.query.startTime || null,
      endTime: req.query.endTime || null,
      limit: req.query.limit || 100
    };

    const events = await listSlaEvents(filters);
    res.json({
      success: true,
      data: events
    });
  } catch (err) {
    console.error('获取SLA事件列表失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.post('/api/migration/tasks', async (req, res) => {
  try {
    const { name, description, batches, flows, previewResult, preMigrationSnapshot } = req.body;

    if (!name) {
      return res.status(400).json({ error: '缺少必要字段: name' });
    }

    const result = await saveMigrationTask({
      name,
      description,
      batches,
      flows,
      previewResult,
      preMigrationSnapshot
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('创建迁移任务失败:', err);
    res.status(500).json({ error: '创建失败' });
  }
});

app.get('/api/migration/tasks', async (req, res) => {
  try {
    const tasks = await listMigrationTasks();
    res.json({
      success: true,
      data: tasks
    });
  } catch (err) {
    console.error('获取迁移任务列表失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.get('/api/migration/tasks/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的任务ID' });
    }

    const task = await getMigrationTask(id);
    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }

    res.json({
      success: true,
      data: task
    });
  } catch (err) {
    console.error('获取迁移任务详情失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.put('/api/migration/tasks/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的任务ID' });
    }

    const result = await updateMigrationTask(id, req.body);
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('更新迁移任务失败:', err);
    res.status(500).json({ error: '更新失败' });
  }
});

app.delete('/api/migration/tasks/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的任务ID' });
    }

    const result = await deleteMigrationTask(id);
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('删除迁移任务失败:', err);
    res.status(500).json({ error: '删除失败' });
  }
});

app.post('/api/migration/tasks/:id/duplicate', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的任务ID' });
    }

    const { newName } = req.body || {};
    const result = await duplicateMigrationTask(id, newName);

    if (!result) {
      return res.status(404).json({ error: '原任务不存在' });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('复制迁移任务失败:', err);
    res.status(500).json({ error: '复制失败' });
  }
});

app.put('/api/migration/batches/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的批次ID' });
    }

    const result = await updateMigrationBatch(id, req.body);
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('更新迁移批次失败:', err);
    res.status(500).json({ error: '更新失败' });
  }
});

app.put('/api/migration/flows/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的流ID' });
    }

    const result = await updateMigrationFlow(id, req.body);
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('更新迁移流失败:', err);
    res.status(500).json({ error: '更新失败' });
  }
});

app.post('/api/fault-playbooks', async (req, res) => {
  try {
    const { name, description, events } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: '剧本名称不能为空' });
    }

    const result = await saveFaultPlaybook({
      name: name.trim(),
      description: description || '',
      events: events || []
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('保存故障剧本失败:', err);
    res.status(500).json({ error: '保存失败' });
  }
});

app.get('/api/fault-playbooks', async (req, res) => {
  try {
    const result = await listFaultPlaybooks();
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('获取故障剧本列表失败:', err);
    res.status(500).json({ error: '获取列表失败' });
  }
});

app.get('/api/fault-playbooks/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的剧本ID' });
    }

    const result = await getFaultPlaybook(id);
    if (!result) {
      return res.status(404).json({ error: '剧本不存在' });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('获取故障剧本详情失败:', err);
    res.status(500).json({ error: '获取详情失败' });
  }
});

app.put('/api/fault-playbooks/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的剧本ID' });
    }

    const { name, description, events } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: '剧本名称不能为空' });
    }

    const result = await saveFaultPlaybook({
      id,
      name: name.trim(),
      description: description || '',
      events: events || []
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('更新故障剧本失败:', err);
    res.status(500).json({ error: '更新失败' });
  }
});

app.delete('/api/fault-playbooks/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的剧本ID' });
    }

    const result = await deleteFaultPlaybook(id);
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('删除故障剧本失败:', err);
    res.status(500).json({ error: '删除失败' });
  }
});

app.post('/api/resilience-reports', async (req, res) => {
  try {
    const reportData = req.body;

    if (!reportData.playbookName) {
      return res.status(400).json({ error: '剧本名称不能为空' });
    }

    const result = await saveResilienceReport(reportData);
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('保存韧性评估报告失败:', err);
    res.status(500).json({ error: '保存失败' });
  }
});

app.get('/api/resilience-reports', async (req, res) => {
  try {
    const result = await listResilienceReports();
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('获取韧性评估报告列表失败:', err);
    res.status(500).json({ error: '获取列表失败' });
  }
});

app.get('/api/resilience-reports/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的报告ID' });
    }

    const result = await getResilienceReport(id);
    if (!result) {
      return res.status(404).json({ error: '报告不存在' });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('获取韧性评估报告详情失败:', err);
    res.status(500).json({ error: '获取详情失败' });
  }
});

app.post('/api/capacity-simulations', async (req, res) => {
  try {
    const simData = req.body;

    if (simData.growthMultiplier === undefined || simData.growthMultiplier === null) {
      return res.status(400).json({ error: '缺少必要字段: growthMultiplier' });
    }

    const result = await saveCapacitySimulation(simData);
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('保存容量模拟失败:', err);
    res.status(500).json({ error: '保存失败' });
  }
});

app.get('/api/capacity-simulations', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const simulations = await listCapacitySimulations(limit);
    res.json({
      success: true,
      data: simulations
    });
  } catch (err) {
    console.error('获取容量模拟列表失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.get('/api/capacity-simulations/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的模拟ID' });
    }

    const simulation = await getCapacitySimulation(id);
    if (!simulation) {
      return res.status(404).json({ error: '模拟记录不存在' });
    }

    res.json({
      success: true,
      data: simulation
    });
  } catch (err) {
    console.error('获取容量模拟失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.post('/api/change-impact-history', async (req, res) => {
  try {
    const data = req.body;
    if (!data.operations || !data.riskLevel) {
      return res.status(400).json({ error: '缺少必要字段: operations, riskLevel' });
    }
    const result = await saveChangeImpactHistory(data);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('保存变更历史失败:', err);
    res.status(500).json({ error: '保存失败' });
  }
});

app.get('/api/change-impact-history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const history = await listChangeImpactHistory(limit);
    res.json({ success: true, data: history });
  } catch (err) {
    console.error('获取变更历史列表失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.get('/api/change-impact-history/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '无效的ID' });
    }
    const record = await getChangeImpactHistory(id);
    if (!record) {
      return res.status(404).json({ error: '记录不存在' });
    }
    res.json({ success: true, data: record });
  } catch (err) {
    console.error('获取变更历史详情失败:', err);
    res.status(500).json({ error: '获取失败' });
  }
});

app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

async function startServer() {
  try {
    await initDatabase();
    console.log('数据库初始化完成');
    
    app.listen(PORT, () => {
      console.log(`拓扑编辑器服务已启动: http://localhost:${PORT}`);
      console.log(`静态文件目录: ${clientPath}`);
    });
  } catch (err) {
    console.error('启动服务失败:', err);
    process.exit(1);
  }
}

startServer();
