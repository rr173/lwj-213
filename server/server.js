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
  compareReports
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
