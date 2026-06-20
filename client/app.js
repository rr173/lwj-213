const canvas = document.getElementById('topologyCanvas');
const ctx = canvas.getContext('2d');

let devices = [];
let links = [];
let manualRoutes = [];
let trafficFlows = [];
let packets = [];
let congestionStates = new Map();

let faultStats = {
    disabledLinkCount: 0,
    totalFaultCount: 0,
    pathSwitchCount: 0,
    pausedFlowCount: 0
};

let batchFaultMode = false;
let batchFaultChanged = false;

let selectedDevice = null;
let selectedLink = null;
let draggedDevice = null;
let dragOffset = { x: 0, y: 0 };

let isPanning = false;
let panStart = { x: 0, y: 0 };
let offset = { x: 0, y: 0 };
let scale = 1;
const minScale = 0.5;
const maxScale = 4;

let isLinking = false;
let linkStartDevice = null;
let mousePos = { x: 0, y: 0 };

let deviceIdCounter = 1;
let linkIdCounter = 1;
let flowIdCounter = 1;
let packetIdCounter = 1;

let lastTime = 0;

const DEVICE_RADIUS = 20;
const MAX_DEVICES = 50;
const MAX_TRAFFIC_FLOWS = 10;

let partitions = [];
let partitionColorMap = new Map();
let partitionChangeHistory = [];
const MAX_PARTITION_HISTORY = 10;

const PARTITION_COLORS = [
    '#1890ff',
    '#52c41a',
    '#fa8c16',
    '#722ed1',
    '#eb2f96',
    '#13c2c2',
    '#fa541c',
    '#2f54eb',
    '#a0d911',
    '#faad14'
];

function calculatePartitions() {
    const visited = new Set();
    const newPartitions = [];
    const newColorMap = new Map();
    
    devices.forEach(device => {
        if (visited.has(device.id)) return;
        
        const partition = [];
        const queue = [device.id];
        visited.add(device.id);
        
        while (queue.length > 0) {
            const currentId = queue.shift();
            partition.push(currentId);
            
            const neighbors = getNeighbors(currentId);
            neighbors.forEach(({ nodeId }) => {
                if (!visited.has(nodeId)) {
                    visited.add(nodeId);
                    queue.push(nodeId);
                }
            });
        }
        
        if (partition.length > 0) {
            const partitionIndex = newPartitions.length;
            newPartitions.push({
                id: partitionIndex + 1,
                deviceIds: partition,
                color: PARTITION_COLORS[partitionIndex % PARTITION_COLORS.length]
            });
            partition.forEach(deviceId => {
                newColorMap.set(deviceId, partitionIndex);
            });
        }
    });
    
    const oldCount = partitions.length;
    const newCount = newPartitions.length;
    
    partitions = newPartitions;
    partitionColorMap = newColorMap;
    
    if (oldCount !== newCount) {
        return { changed: true, oldCount, newCount };
    }
    
    return { changed: false, oldCount, newCount };
}

function getDevicePartitionIndex(deviceId) {
    return partitionColorMap.get(deviceId);
}

function areDevicesInSamePartition(deviceId1, deviceId2) {
    const p1 = getDevicePartitionIndex(deviceId1);
    const p2 = getDevicePartitionIndex(deviceId2);
    return p1 !== undefined && p2 !== undefined && p1 === p2;
}

function getPartitionColor(deviceId) {
    const idx = getDevicePartitionIndex(deviceId);
    if (idx === undefined) return null;
    return partitions[idx]?.color || null;
}

function recordPartitionChange(oldCount, newCount, triggerLinkId, triggerAction) {
    const event = {
        id: Date.now(),
        timestamp: Date.now(),
        oldCount: oldCount,
        newCount: newCount,
        triggerLinkId: triggerLinkId || null,
        triggerAction: triggerAction || null,
        triggerLinkName: triggerLinkId ? getLinkDisplayName(triggerLinkId) : null
    };
    
    partitionChangeHistory.unshift(event);
    if (partitionChangeHistory.length > MAX_PARTITION_HISTORY) {
        partitionChangeHistory = partitionChangeHistory.slice(0, MAX_PARTITION_HISTORY);
    }
    
    savePartitionChangeToBackend(event);
}

function getLinkDisplayName(linkId) {
    const link = links.find(l => l.id === linkId);
    if (!link) return '未知链路';
    const from = devices.find(d => d.id === link.from);
    const to = devices.find(d => d.id === link.to);
    return `${from?.name || '?'} - ${to?.name || '?'}`;
}

function triggerPartitionRecalculation(triggerLinkId, triggerAction) {
    const result = calculatePartitions();
    if (result.changed) {
        recordPartitionChange(result.oldCount, result.newCount, triggerLinkId, triggerAction);
    }
    updatePartitionPanel();
}

function init() {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    setupCanvasEvents();
    setupDeviceDrag();
    setupUIEvents();
    setupModalEvents();
    setupContextMenu();
    setupScenarioEvents();
    setupBackendEvents();
    setupConfigAuditEvents();
    
    updateDeviceCount();
    updateDeviceSelects();
    updateFaultStats();
    calculatePartitions();
    updatePartitionPanel();
    loadPartitionHistory();
    
    requestAnimationFrame(animate);
}

function resizeCanvas() {
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight - 40 - 150;
}

function screenToWorld(sx, sy) {
    return {
        x: (sx - offset.x) / scale,
        y: (sy - offset.y) / scale
    };
}

function worldToScreen(wx, wy) {
    return {
        x: wx * scale + offset.x,
        y: wy * scale + offset.y
    };
}

function setupCanvasEvents() {
    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const worldPos = screenToWorld(x, y);
        
        if (e.button === 2) {
            const device = getDeviceAt(worldPos.x, worldPos.y);
            const link = getLinkAt(worldPos.x, worldPos.y);
            if (device || link) {
                showContextMenu(e.clientX, e.clientY, device || link);
                e.preventDefault();
            }
            return;
        }
        
        if (e.button === 0) {
            const device = getDeviceAt(worldPos.x, worldPos.y);
            const link = getLinkAt(worldPos.x, worldPos.y);
            
            if (device) {
                selectedDevice = device;
                selectedLink = null;
                if (!isPlayback) {
                    draggedDevice = device;
                    dragOffset = {
                        x: worldPos.x - device.x,
                        y: worldPos.y - device.y
                    };
                }
                updatePropertyPanel();
            } else if (link) {
                selectedLink = link;
                selectedDevice = null;
                updatePropertyPanel();
            } else {
                selectedDevice = null;
                selectedLink = null;
                isPanning = true;
                panStart = { x: e.clientX - offset.x, y: e.clientY - offset.y };
                updatePropertyPanel();
            }
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const worldPos = screenToWorld(x, y);
        mousePos = worldPos;
        
        if (isPanning) {
            offset.x = e.clientX - panStart.x;
            offset.y = e.clientY - panStart.y;
        }
        
        if (draggedDevice && !isPlayback) {
            draggedDevice.x = worldPos.x - dragOffset.x;
            draggedDevice.y = worldPos.y - dragOffset.y;
            updateRoutingTables();
        }
        
        if (isLinking && !isPlayback) {
            mousePos = worldPos;
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (isPanning) {
            isPanning = false;
        }
        
        if (draggedDevice) {
            draggedDevice = null;
            recalculateRoutes();
        }
        
        if (isLinking && !isPlayback) {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const worldPos = screenToWorld(x, y);
            const targetDevice = getDeviceAt(worldPos.x, worldPos.y);
            
            if (targetDevice && targetDevice !== linkStartDevice) {
                if (!hasLinkBetween(linkStartDevice.id, targetDevice.id)) {
                    showLinkConfigModal(linkStartDevice, targetDevice);
                }
            }
            
            isLinking = false;
            linkStartDevice = null;
        } else if (isLinking && isPlayback) {
            isLinking = false;
            linkStartDevice = null;
        }
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const worldX = (mouseX - offset.x) / scale;
        const worldY = (mouseY - offset.y) / scale;
        
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.min(maxScale, Math.max(minScale, scale * delta));
        
        offset.x = mouseX - worldX * newScale;
        offset.y = mouseY - worldY * newScale;
        scale = newScale;
        
        updateZoomLevel();
    });

    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    canvas.addEventListener('dblclick', (e) => {
        if (isPlayback) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const worldPos = screenToWorld(x, y);
        
        const device = getDeviceAt(worldPos.x, worldPos.y);
        if (device) {
            isLinking = true;
            linkStartDevice = device;
            mousePos = worldPos;
        }
    });

    document.addEventListener('mousedown', (e) => {
        if (!canvas.contains(e.target) && !e.target.closest('.context-menu')) {
            hideContextMenu();
        }
    });
}

function setupDeviceDrag() {
    const deviceItems = document.querySelectorAll('.device-item');
    
    deviceItems.forEach(item => {
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('deviceType', item.dataset.type);
            canvas.classList.add('dragging-device');
        });
        
        item.addEventListener('dragend', () => {
            canvas.classList.remove('dragging-device');
        });
    });

    canvas.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    canvas.addEventListener('drop', (e) => {
        e.preventDefault();
        canvas.classList.remove('dragging-device');
        
        if (isPlayback) {
            addLog('回放模式下无法修改拓扑', 'warning');
            return;
        }
        
        const deviceType = e.dataTransfer.getData('deviceType');
        if (!deviceType) return;
        
        if (devices.length >= MAX_DEVICES) {
            alert('设备数量已达上限（50个）');
            return;
        }
        
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const worldPos = screenToWorld(x, y);
        
        addDevice(deviceType, worldPos.x, worldPos.y);
    });
}

function addDevice(type, x, y) {
    if (isPlayback) {
        addLog('回放模式下无法修改拓扑', 'warning');
        return null;
    }
    const typeNames = {
        router: '路由器',
        switch: '交换机',
        host: '主机'
    };
    
    const device = {
        id: deviceIdCounter++,
        type: type,
        name: `${typeNames[type]}${deviceIdCounter - 1}`,
        x: x,
        y: y
    };
    
    devices.push(device);
    updateDeviceCount();
    updateDeviceSelects();
    recalculateRoutes();
    triggerPartitionRecalculation(null, 'add_device');
    
    return device;
}

function deleteDevice(deviceId) {
    if (isPlayback) {
        addLog('回放模式下无法修改拓扑', 'warning');
        return;
    }
    const deviceIndex = devices.findIndex(d => d.id === deviceId);
    if (deviceIndex === -1) return;
    
    const removedLinks = links.filter(l => l.from === deviceId || l.to === deviceId);
    const disabledRemovedCount = removedLinks.filter(l => !l.enabled).length;
    faultStats.disabledLinkCount -= disabledRemovedCount;
    
    links = links.filter(l => l.from !== deviceId && l.to !== deviceId);
    
    manualRoutes = manualRoutes.filter(r => r.src !== deviceId && r.dst !== deviceId);
    
    devices.splice(deviceIndex, 1);
    
    trafficFlows = trafficFlows.filter(f => f.srcId !== deviceId && f.dstId !== deviceId);
    packets = packets.filter(p => p.srcId !== deviceId || p.dstId !== deviceId);
    
    if (selectedDevice && selectedDevice.id === deviceId) {
        selectedDevice = null;
        updatePropertyPanel();
    }
    
    updateDeviceCount();
    updateDeviceSelects();
    recalculateRoutes();
    rerouteAffectedFlows();
    updateTrafficList();
    updateFaultStats();
    triggerPartitionRecalculation(null, 'delete_device');
}

function getDeviceAt(x, y) {
    for (let i = devices.length - 1; i >= 0; i--) {
        const d = devices[i];
        const dx = x - d.x;
        const dy = y - d.y;
        if (Math.sqrt(dx * dx + dy * dy) < DEVICE_RADIUS) {
            return d;
        }
    }
    return null;
}

function getLinkAt(x, y) {
    for (let i = links.length - 1; i >= 0; i--) {
        const link = links[i];
        const from = devices.find(d => d.id === link.from);
        const to = devices.find(d => d.id === link.to);
        if (!from || !to) continue;
        
        const dist = pointToLineDistance(x, y, from.x, from.y, to.x, to.y);
        if (dist < 8) {
            return link;
        }
    }
    return null;
}

function pointToLineDistance(px, py, x1, y1, x2, y2) {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    
    if (lenSq !== 0) param = dot / lenSq;
    
    let xx, yy;
    
    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }
    
    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
}

function hasLinkBetween(fromId, toId) {
    return links.some(l => 
        (l.from === fromId && l.to === toId) || 
        (l.from === toId && l.to === fromId)
    );
}

function addLink(fromId, toId, bandwidth, delay, reservationRatio) {
    if (isPlayback) {
        addLog('回放模式下无法修改拓扑', 'warning');
        return null;
    }
    const link = {
        id: linkIdCounter++,
        from: fromId,
        to: toId,
        bandwidth: bandwidth,
        delay: delay,
        reservationRatio: reservationRatio || 0,
        enabled: true
    };
    
    links.push(link);
    recalculateRoutes();
    triggerPartitionRecalculation(link.id, 'add_link');
    
    return link;
}

function deleteLink(linkId) {
    if (isPlayback) {
        addLog('回放模式下无法修改拓扑', 'warning');
        return;
    }
    const link = links.find(l => l.id === linkId);
    if (link && !link.enabled) {
        faultStats.disabledLinkCount--;
    }
    
    links = links.filter(l => l.id !== linkId);
    
    if (selectedLink && selectedLink.id === linkId) {
        selectedLink = null;
        updatePropertyPanel();
    }
    
    recalculateRoutes();
    updateFaultStats();
    triggerPartitionRecalculation(linkId, 'delete_link');
}

function toggleLinkEnabled(linkId) {
    if (isPlayback) {
        addLog('回放模式下无法修改拓扑', 'warning');
        return;
    }
    const link = links.find(l => l.id === linkId);
    if (!link) return;
    
    link.enabled = !link.enabled;
    
    if (link.enabled) {
        faultStats.disabledLinkCount--;
    } else {
        faultStats.disabledLinkCount++;
        faultStats.totalFaultCount++;
    }
    
    if (batchFaultMode) {
        batchFaultChanged = true;
        updatePropertyPanel();
        updateFaultStats();
        return;
    }
    
    const action = link.enabled ? 'enable_link' : 'disable_link';
    handleLinkStateChange(linkId, action);
}

function handleLinkStateChange(triggerLinkId = null, triggerAction = null) {
    recalculateRoutes();
    rerouteAffectedFlows();
    updatePropertyPanel();
    updateFaultStats();
    triggerPartitionRecalculation(triggerLinkId, triggerAction);
}

function getPathNodeNames(path) {
    if (!path || !path.nodes) return '';
    return path.nodes.map(id => getDeviceName(id)).join(' → ');
}

function rerouteAffectedFlows() {
    trafficFlows.forEach(flow => {
        if (flow.completed) return;
        
        const currentPath = flow.path;
        
        if (!currentPath || !currentPath.segments || currentPath.segments.length === 0) {
            if (flow.paused) {
                const newPath = getPath(flow.srcId, flow.dstId);
                if (newPath) {
                    flow.path = newPath;
                    flow.paused = false;
                    flow.pauseReason = null;
                    addLog(`流量${flow.id}恢复`, 'success');
                    faultStats.pathSwitchCount++;
                }
            }
            return;
        }
        
        const hasDisabledLink = currentPath.segments.some(seg => {
            const link = links.find(l => l.id === seg.link.id);
            return !link || !link.enabled;
        });
        
        if (hasDisabledLink || flow.paused) {
            const newPath = getPath(flow.srcId, flow.dstId);
            
            if (newPath) {
                const oldPathStr = getPathNodeNames(currentPath);
                const newPathStr = getPathNodeNames(newPath);
                
                flow.path = newPath;
                
                if (flow.paused) {
                    flow.paused = false;
                    flow.pauseReason = null;
                    addLog(`流量${flow.id}恢复`, 'success');
                } else {
                    addLog(`流量${flow.id}路径切换: ${oldPathStr} -> ${newPathStr}`, 'warning');
                }
                
                faultStats.pathSwitchCount++;
                
                packets.forEach(packet => {
                    if (packet.flowId === flow.id && !packet.completed && !packet.isLost) {
                        packet.path = newPath;
                        if (packet.currentSegment >= newPath.segments.length) {
                            packet.currentSegment = 0;
                            packet.progress = 0;
                        }
                        updatePacketSpeed(packet);
                    }
                });
            } else {
                if (!flow.paused) {
                    flow.paused = true;
                    flow.pauseReason = 'no_route';
                    faultStats.pausedFlowCount++;
                    addLog(`流量${flow.id}暂停: 无可用路径`, 'error');
                }
            }
        } else {
            const newPath = getPath(flow.srcId, flow.dstId);
            if (newPath && newPath.totalDelay < currentPath.totalDelay) {
                const oldPathStr = getPathNodeNames(currentPath);
                const newPathStr = getPathNodeNames(newPath);
                
                flow.path = newPath;
                addLog(`流量${flow.id}路径切换: ${oldPathStr} -> ${newPathStr}`, 'info');
                faultStats.pathSwitchCount++;
                
                packets.forEach(packet => {
                    if (packet.flowId === flow.id && !packet.completed && !packet.isLost) {
                        packet.path = newPath;
                        if (packet.currentSegment >= newPath.segments.length) {
                            packet.currentSegment = 0;
                            packet.progress = 0;
                        }
                        updatePacketSpeed(packet);
                    }
                });
            }
        }
    });
    
    updateTrafficList();
    updateLinkCongestion();
}

function restoreAllLinks() {
    let hasRestored = false;
    
    links.forEach(link => {
        if (!link.enabled) {
            link.enabled = true;
            hasRestored = true;
        }
    });
    
    faultStats.disabledLinkCount = 0;
    
    if (hasRestored) {
        handleLinkStateChange();
        addLog('所有链路已恢复', 'success');
    }
}

function startBatchFault() {
    batchFaultMode = true;
    batchFaultChanged = false;
    updateBatchFaultUI();
}

function endBatchFault() {
    batchFaultMode = false;
    if (batchFaultChanged) {
        handleLinkStateChange();
        batchFaultChanged = false;
    }
    updateBatchFaultUI();
}

function toggleBatchFaultMode() {
    if (batchFaultMode) {
        endBatchFault();
    } else {
        startBatchFault();
    }
}

function updateBatchFaultUI() {
    const btn = document.getElementById('batchFaultBtn');
    const hint = document.getElementById('batchFaultHint');
    
    if (btn) {
        btn.textContent = batchFaultMode ? '应用' : '批量模式';
        btn.classList.toggle('btn-primary', batchFaultMode);
    }
    
    if (hint) {
        hint.style.display = batchFaultMode ? 'block' : 'none';
    }
}

function getLinkLoad(linkId) {
    const link = links.find(l => l.id === linkId);
    if (!link || !link.enabled) return 0;
    
    let totalRate = 0;
    trafficFlows.forEach(flow => {
        if (flow.path && flow.path.segments && flow.path.segments.some(seg => 
            (seg.from === link.from && seg.to === link.to) ||
            (seg.from === link.to && seg.to === link.from)
        )) {
            totalRate += flow.actualRate || flow.rate;
        }
    });
    
    return totalRate / (link.bandwidth * 1000000);
}

function getPriorityRateOnLink(linkId) {
    const link = links.find(l => l.id === linkId);
    if (!link || !link.enabled) return 0;

    let totalRate = 0;
    trafficFlows.forEach(flow => {
        if (flow.priority !== 'priority' || flow.completed || flow.paused) return;
        if (flow.path && flow.path.segments && flow.path.segments.some(seg =>
            (seg.from === link.from && seg.to === link.to) ||
            (seg.from === link.to && seg.to === link.from)
        )) {
            totalRate += flow.rate;
        }
    });
    return totalRate;
}

function getNormalRateOnLink(linkId) {
    const link = links.find(l => l.id === linkId);
    if (!link || !link.enabled) return 0;

    let totalRate = 0;
    trafficFlows.forEach(flow => {
        if (flow.priority === 'priority' || flow.completed || flow.paused) return;
        if (flow.path && flow.path.segments && flow.path.segments.some(seg =>
            (seg.from === link.from && seg.to === link.to) ||
            (seg.from === link.to && seg.to === link.from)
        )) {
            totalRate += flow.rate;
        }
    });
    return totalRate;
}

function getReservedPoolLoad(linkId) {
    const link = links.find(l => l.id === linkId);
    if (!link || !link.enabled) return 0;
    const reservedBw = link.bandwidth * (link.reservationRatio || 0) / 100;
    if (reservedBw <= 0) return 0;
    const priorityRate = getPriorityRateOnLink(linkId);
    return priorityRate / (reservedBw * 1000000);
}

function getBestEffortPoolLoad(linkId) {
    const link = links.find(l => l.id === linkId);
    if (!link || !link.enabled) return 0;
    const reservedBw = link.bandwidth * (link.reservationRatio || 0) / 100;
    const bestEffortBw = link.bandwidth - reservedBw;
    if (bestEffortBw <= 0) return 0;
    const normalRate = getNormalRateOnLink(linkId);
    return normalRate / (bestEffortBw * 1000000);
}

function getLinkQoSStats(linkId) {
    const link = links.find(l => l.id === linkId);
    if (!link || !link.enabled) return null;

    const reservedBw = link.bandwidth * (link.reservationRatio || 0) / 100;
    const bestEffortBw = link.bandwidth - reservedBw;

    let priorityCount = 0;
    let normalCount = 0;
    let priorityRate = 0;
    let normalRate = 0;

    trafficFlows.forEach(flow => {
        if (flow.completed || flow.paused) return;
        if (flow.path && flow.path.segments && flow.path.segments.some(seg =>
            (seg.from === link.from && seg.to === link.to) ||
            (seg.from === link.to && seg.to === link.from)
        )) {
            if (flow.priority === 'priority') {
                priorityCount++;
                priorityRate += flow.rate;
            } else {
                normalCount++;
                normalRate += flow.rate;
            }
        }
    });

    return {
        reservedBw,
        bestEffortBw,
        reservedPoolUsage: reservedBw > 0 ? (priorityRate / (reservedBw * 1000000) * 100) : 0,
        bestEffortPoolUsage: bestEffortBw > 0 ? (normalRate / (bestEffortBw * 1000000) * 100) : 0,
        priorityCount,
        normalCount,
        priorityRate: priorityRate / 1000000,
        normalRate: normalRate / 1000000
    };
}

function getLinkRequestedLoad(linkId) {
    const link = links.find(l => l.id === linkId);
    if (!link || !link.enabled) return 0;
    
    let totalRate = 0;
    trafficFlows.forEach(flow => {
        if (flow.completed || flow.paused) return;
        if (flow.path && flow.path.segments && flow.path.segments.some(seg => 
            (seg.from === link.from && seg.to === link.to) ||
            (seg.from === link.to && seg.to === link.from)
        )) {
            totalRate += flow.rate;
        }
    });
    
    return totalRate / (link.bandwidth * 1000000);
}

function recalculateRoutes() {
    updateRoutingTables();
    updateRoutingTableDisplay();
    updateManualRouteList();
}

function dijkstra(srcId) {
    const dist = {};
    const prev = {};
    const visited = new Set();
    
    devices.forEach(d => {
        dist[d.id] = Infinity;
        prev[d.id] = null;
    });
    dist[srcId] = 0;
    
    while (true) {
        let minDist = Infinity;
        let minNode = null;
        
        devices.forEach(d => {
            if (!visited.has(d.id) && dist[d.id] < minDist) {
                minDist = dist[d.id];
                minNode = d.id;
            }
        });
        
        if (minNode === null) break;
        visited.add(minNode);
        
        const neighbors = getNeighbors(minNode);
        neighbors.forEach(({ nodeId, delay }) => {
            if (!visited.has(nodeId)) {
                const alt = dist[minNode] + delay;
                if (alt < dist[nodeId]) {
                    dist[nodeId] = alt;
                    prev[nodeId] = minNode;
                }
            }
        });
    }
    
    return { dist, prev };
}

function getNeighbors(deviceId) {
    const neighbors = [];
    links.forEach(link => {
        if (!link.enabled) return;
        if (link.from === deviceId) {
            neighbors.push({ nodeId: link.to, delay: link.delay });
        } else if (link.to === deviceId) {
            neighbors.push({ nodeId: link.from, delay: link.delay });
        }
    });
    return neighbors;
}

function getPath(srcId, dstId, ignoreManual = false) {
    if (!ignoreManual) {
        const manualRoute = manualRoutes.find(r => r.src === srcId && r.dst === dstId);
        if (manualRoute) {
            return getPathWithNextHop(srcId, dstId, manualRoute.nextHop);
        }
    }
    
    const { dist, prev } = dijkstra(srcId);
    
    if (dist[dstId] === Infinity) {
        return null;
    }
    
    const path = [];
    let current = dstId;
    while (current !== srcId && current !== null) {
        path.unshift(current);
        current = prev[current];
    }
    path.unshift(srcId);
    
    const segments = [];
    for (let i = 0; i < path.length - 1; i++) {
        const link = findLink(path[i], path[i + 1]);
        if (link && link.enabled) {
            segments.push({
                from: path[i],
                to: path[i + 1],
                link: link
            });
        }
    }
    
    return {
        nodes: path,
        segments: segments,
        totalDelay: dist[dstId],
        isManual: false
    };
}

function getPathWithNextHop(srcId, dstId, nextHopId) {
    const link = findLink(srcId, nextHopId);
    if (!link || !link.enabled) {
        return getPath(srcId, dstId, true);
    }
    
    const { dist, prev } = dijkstra(nextHopId);
    
    if (dist[dstId] === Infinity) {
        return getPath(srcId, dstId, true);
    }
    
    const path = [srcId];
    let current = dstId;
    const restPath = [];
    while (current !== nextHopId && current !== null) {
        restPath.unshift(current);
        current = prev[current];
    }
    path.push(nextHopId, ...restPath);
    
    const pathSet = new Set(path);
    if (pathSet.size !== path.length) {
        return getPath(srcId, dstId, true);
    }
    
    const segments = [];
    for (let i = 0; i < path.length - 1; i++) {
        const segLink = findLink(path[i], path[i + 1]);
        if (segLink && segLink.enabled) {
            segments.push({
                from: path[i],
                to: path[i + 1],
                link: segLink
            });
        }
    }
    
    return {
        nodes: path,
        segments: segments,
        totalDelay: link.delay + dist[dstId],
        isManual: true
    };
}

function findLink(fromId, toId) {
    return links.find(l => 
        (l.from === fromId && l.to === toId) ||
        (l.from === toId && l.to === fromId)
    );
}

function getNextHop(srcId, dstId) {
    const pathResult = getPath(srcId, dstId);
    if (!pathResult || pathResult.nodes.length < 2) {
        return null;
    }
    return pathResult.nodes[1];
}

function updateRoutingTables() {
}

function injectTraffic(srcId, dstId, dataSizeKB, rateMbps, priority) {
    if (isPlayback) {
        addLog('回放模式下无法注入新流量', 'warning');
        return false;
    }
    if (trafficFlows.length >= MAX_TRAFFIC_FLOWS) {
        addLog('活跃流量已达上限（10条）', 'error');
        return false;
    }
    
    if (!areDevicesInSamePartition(srcId, dstId)) {
        addLog(`源和目的不在同一分区，无法通信: ${getDeviceName(srcId)} → ${getDeviceName(dstId)}`, 'error');
        return false;
    }
    
    const pathResult = getPath(srcId, dstId);
    if (!pathResult) {
        addLog(`从 ${getDeviceName(srcId)} 到 ${getDeviceName(dstId)} 不可达`, 'error');
        return false;
    }

    const isPriority = priority === 'priority';
    let demoted = false;

    if (isPriority) {
        for (const seg of pathResult.segments) {
            const link = seg.link;
            const reservedBw = link.bandwidth * (link.reservationRatio || 0) / 100 * 1000000;
            const priorityRateOnLink = getPriorityRateOnLink(link.id);
            if (priorityRateOnLink + rateMbps * 1000000 > reservedBw && reservedBw > 0) {
                demoted = true;
                break;
            } else if (reservedBw === 0) {
                demoted = true;
                break;
            }
        }
        if (demoted) {
            addLog(`预留带宽不足,降级为普通: ${getDeviceName(srcId)} → ${getDeviceName(dstId)}`, 'warning');
        }
    }
    
    const flow = {
        id: flowIdCounter++,
        srcId: srcId,
        dstId: dstId,
        dataSize: dataSizeKB * 1024 * 8,
        rate: rateMbps * 1000000,
        actualRate: rateMbps * 1000000,
        sent: 0,
        startTime: Date.now(),
        path: pathResult,
        packets: [],
        totalPackets: Math.ceil(dataSizeKB / 10),
        sentPackets: 0,
        lostPackets: 0,
        completed: false,
        priority: demoted ? 'normal' : (priority || 'normal'),
        demoted: demoted
    };
    
    trafficFlows.push(flow);
    addLog(`注入流量: ${getDeviceName(srcId)} → ${getDeviceName(dstId)}, ${dataSizeKB}KB, ${rateMbps}Mbps`, 'success');
    updateTrafficList();
    updateLinkCongestion();
    
    return true;
}

function updateLinkCongestion() {
    const linkLoads = new Map();
    
    links.forEach(link => {
        linkLoads.set(link.id, { 
            totalRequest: 0, 
            priorityRequest: 0,
            normalRequest: 0,
            priorityFlows: [],
            normalFlows: [],
            flows: []
        });
    });
    
    trafficFlows.forEach(flow => {
        if (!flow.path || flow.completed || flow.paused) return;
        
        flow.actualRate = flow.rate;
        
        flow.path.segments.forEach(seg => {
            const loadInfo = linkLoads.get(seg.link.id);
            if (loadInfo) {
                loadInfo.totalRequest += flow.rate;
                loadInfo.flows.push(flow);
                if (flow.priority === 'priority') {
                    loadInfo.priorityRequest += flow.rate;
                    loadInfo.priorityFlows.push(flow);
                } else {
                    loadInfo.normalRequest += flow.rate;
                    loadInfo.normalFlows.push(flow);
                }
            }
        });
    });
    
    links.forEach(link => {
        const loadInfo = linkLoads.get(link.id);
        const totalBw = link.bandwidth * 1000000;
        const reservationRatio = link.reservationRatio || 0;
        const reservedBw = totalBw * reservationRatio / 100;
        const bestEffortBw = totalBw - reservedBw;

        let reservedCongested = false;
        let bestEffortCongested = false;

        if (reservationRatio > 0 && reservedBw > 0) {
            const reservedLoadRatio = loadInfo.priorityRequest / reservedBw;
            if (reservedLoadRatio > 1) {
                reservedCongested = true;
                const ratio = reservedBw / loadInfo.priorityRequest;
                loadInfo.priorityFlows.forEach(flow => {
                    const limitedRate = flow.rate * ratio;
                    if (limitedRate < flow.actualRate) {
                        flow.actualRate = limitedRate;
                    }
                });
            }
        }

        if (bestEffortBw > 0) {
            const bestEffortLoadRatio = loadInfo.normalRequest / bestEffortBw;
            if (bestEffortLoadRatio > 1) {
                bestEffortCongested = true;
                const ratio = bestEffortBw / loadInfo.normalRequest;
                loadInfo.normalFlows.forEach(flow => {
                    const limitedRate = flow.rate * ratio;
                    if (limitedRate < flow.actualRate) {
                        flow.actualRate = limitedRate;
                    }
                });
            }
        }

        const isCongested = reservedCongested || bestEffortCongested;
        if (isCongested) {
            if (!congestionStates.has(link.id)) {
                congestionStates.set(link.id, {
                    startTime: Date.now(),
                    packetLossActive: false,
                    reservedCongested: reservedCongested,
                    bestEffortCongested: bestEffortCongested
                });
            } else {
                const state = congestionStates.get(link.id);
                state.reservedCongested = reservedCongested;
                state.bestEffortCongested = bestEffortCongested;
                if (Date.now() - state.startTime > 3000) {
                    state.packetLossActive = true;
                }
            }
        } else {
            if (congestionStates.has(link.id)) {
                congestionStates.delete(link.id);
            }
        }
    });
}

function spawnPackets(deltaTime) {
    trafficFlows.forEach(flow => {
        if (flow.completed || !flow.path || flow.paused) return;
        
        const bytesPerMs = (flow.actualRate / 8) / 1000;
        flow.sent += bytesPerMs * deltaTime;
        
        const packetsShouldHave = Math.min(flow.totalPackets, Math.floor(flow.sent / (10 * 1024 * 8 / 8)));
        
        while (flow.sentPackets < packetsShouldHave) {
            createPacket(flow);
            flow.sentPackets++;
        }
    });
}

function createPacket(flow) {
    const state = congestionStates.get(flow.path.segments[0]?.link?.id);
    const isLost = state?.packetLossActive && Math.random() < 0.2;
    
    const packet = {
        id: packetIdCounter++,
        flowId: flow.id,
        srcId: flow.srcId,
        dstId: flow.dstId,
        path: flow.path,
        currentSegment: 0,
        progress: 0,
        speed: 0,
        isLost: isLost,
        lostAnimation: isLost ? 0 : -1,
        completed: false
    };
    
    updatePacketSpeed(packet);
    
    if (isLost) {
        flow.lostPackets++;
    }
    
    packets.push(packet);
    flow.packets.push(packet.id);
}

function updatePacketSpeed(packet) {
    if (packet.currentSegment >= packet.path.segments.length) return;
    
    const segment = packet.path.segments[packet.currentSegment];
    const link = segment.link;
    
    const fromDevice = devices.find(d => d.id === segment.from);
    const toDevice = devices.find(d => d.id === segment.to);
    
    if (!fromDevice || !toDevice) return;
    
    const distance = Math.sqrt(
        Math.pow(toDevice.x - fromDevice.x, 2) +
        Math.pow(toDevice.y - fromDevice.y, 2)
    );
    
    packet.speed = distance / (link.delay * 50);
}

function updatePackets(deltaTime) {
    for (let i = packets.length - 1; i >= 0; i--) {
        const packet = packets[i];
        
        if (packet.isLost) {
            packet.lostAnimation += deltaTime;
            if (packet.lostAnimation > 500) {
                packets.splice(i, 1);
            }
            continue;
        }
        
        if (packet.completed) {
            packets.splice(i, 1);
            continue;
        }
        
        packet.progress += packet.speed * deltaTime;
        
        if (packet.progress >= 1) {
            packet.currentSegment++;
            packet.progress = 0;
            
            if (packet.currentSegment >= packet.path.segments.length) {
                packet.completed = true;
                const flow = trafficFlows.find(f => f.id === packet.flowId);
                if (flow) {
                    flow.receivedPackets = (flow.receivedPackets || 0) + 1;
                }
            } else {
                const seg = packet.path.segments[packet.currentSegment];
                const state = congestionStates.get(seg.link.id);
                if (state?.packetLossActive && Math.random() < 0.2) {
                    packet.isLost = true;
                    packet.lostAnimation = 0;
                    const flow = trafficFlows.find(f => f.id === packet.flowId);
                    if (flow) {
                        flow.lostPackets++;
                    }
                } else {
                    updatePacketSpeed(packet);
                }
            }
        }
    }
}

function checkFlowCompletion() {
    const newlyCompleted = [];
    
    trafficFlows.forEach(flow => {
        if (flow.completed || !flow.path) return;
        
        if (flow.sentPackets >= flow.totalPackets && 
            flow.packets.filter(pid => {
                const p = packets.find(pp => pp.id === pid);
                return p && !p.completed && !p.isLost;
            }).length === 0) {
            
            flow.completed = true;
            flow.endTime = Date.now();
            newlyCompleted.push(flow);
            
            const duration = (flow.endTime - flow.startTime) / 1000;
            const lossRate = flow.totalPackets > 0 ? (flow.lostPackets / flow.totalPackets * 100).toFixed(1) : 0;
            
            addLog(
                `流量完成: ${getDeviceName(flow.srcId)} → ${getDeviceName(flow.dstId)}, ` +
                `耗时 ${duration.toFixed(2)}s, 丢包率 ${lossRate}%`,
                lossRate > 0 ? 'warning' : 'success'
            );
        }
    });
    
    newlyCompleted.forEach(flow => recordFlowCompletion(flow));
    
    const beforeCount = trafficFlows.length;
    trafficFlows = trafficFlows.filter(f => !f.completed);
    
    if (beforeCount !== trafficFlows.length) {
        updateTrafficList();
        updateLinkCongestion();
    }
}

function getPacketPosition(packet) {
    if (packet.currentSegment >= packet.path.segments.length) {
        const lastSeg = packet.path.segments[packet.path.segments.length - 1];
        const toDevice = devices.find(d => d.id === lastSeg.to);
        return { x: toDevice.x, y: toDevice.y };
    }
    
    const segment = packet.path.segments[packet.currentSegment];
    const fromDevice = devices.find(d => d.id === segment.from);
    const toDevice = devices.find(d => d.id === segment.to);
    
    return {
        x: fromDevice.x + (toDevice.x - fromDevice.x) * packet.progress,
        y: fromDevice.y + (toDevice.y - fromDevice.y) * packet.progress
    };
}

function getDeviceName(deviceId) {
    const device = devices.find(d => d.id === deviceId);
    return device ? device.name : '未知';
}

function addLog(message, type = 'info') {
    const logContent = document.getElementById('logContent');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${message}`;
    
    logContent.appendChild(entry);
    logContent.scrollTop = logContent.scrollHeight;
}

function animate(timestamp) {
    const deltaTime = lastTime ? (timestamp - lastTime) : 16;
    lastTime = timestamp;
    
    spawnPackets(deltaTime);
    updatePackets(deltaTime);
    checkFlowCompletion();
    updateLinkCongestion();
    updateTrafficProgress();
    updateQoSStatsPanel();
    
    render();
    
    requestAnimationFrame(animate);
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(scale, scale);
    
    drawGrid();
    
    links.forEach(link => drawLink(link));
    
    if (isLinking && linkStartDevice) {
        drawTemporaryLink();
    }
    
    packets.forEach(packet => drawPacket(packet));
    
    devices.forEach(device => drawDevice(device));
    
    ctx.restore();
}

function drawGrid() {
    const gridSize = 50;
    const startX = -offset.x / scale;
    const startY = -offset.y / scale;
    const endX = startX + canvas.width / scale;
    const endY = startY + canvas.height / scale;
    
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 0.5;
    
    for (let x = Math.floor(startX / gridSize) * gridSize; x < endX; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
        ctx.stroke();
    }
    
    for (let y = Math.floor(startY / gridSize) * gridSize; y < endY; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
    }
}

function drawDevice(device) {
    const isSelected = selectedDevice && selectedDevice.id === device.id;
    const partitionColor = getPartitionColor(device.id);
    
    ctx.save();
    ctx.translate(device.x, device.y);
    
    if (partitionColor && partitions.length > 1) {
        ctx.beginPath();
        ctx.arc(0, 0, DEVICE_RADIUS + 6, 0, Math.PI * 2);
        ctx.strokeStyle = partitionColor;
        ctx.lineWidth = 3;
        ctx.stroke();
    }
    
    if (isSelected) {
        ctx.beginPath();
        ctx.arc(0, 0, DEVICE_RADIUS + 3, 0, Math.PI * 2);
        ctx.strokeStyle = '#1890ff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    
    const colors = {
        router: '#1890ff',
        switch: '#52c41a',
        host: '#fa8c16'
    };
    
    const color = colors[device.type] || '#666';
    
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    
    if (device.type === 'router') {
        ctx.beginPath();
        ctx.arc(0, 0, DEVICE_RADIUS - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-8, 0);
        ctx.lineTo(8, 0);
        ctx.moveTo(0, -8);
        ctx.lineTo(0, 8);
        ctx.stroke();
    } else if (device.type === 'switch') {
        ctx.beginPath();
        ctx.moveTo(0, -(DEVICE_RADIUS - 4));
        ctx.lineTo(DEVICE_RADIUS - 4, 0);
        ctx.lineTo(0, DEVICE_RADIUS - 4);
        ctx.lineTo(-(DEVICE_RADIUS - 4), 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    } else {
        ctx.fillRect(-(DEVICE_RADIUS - 4), -(DEVICE_RADIUS - 4), (DEVICE_RADIUS - 4) * 2, (DEVICE_RADIUS - 4) * 2);
        ctx.strokeRect(-(DEVICE_RADIUS - 4), -(DEVICE_RADIUS - 4), (DEVICE_RADIUS - 4) * 2, (DEVICE_RADIUS - 4) * 2);
    }
    
    ctx.fillStyle = '#333';
    ctx.font = '12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(device.name, 0, DEVICE_RADIUS + 14);
    
    ctx.restore();
}

function drawLink(link) {
    const from = devices.find(d => d.id === link.from);
    const to = devices.find(d => d.id === link.to);
    if (!from || !to) return;
    
    let lineWidth = 2 + (link.bandwidth / 10000) * 6;
    let color = '#52c41a';
    let isDisabled = !link.enabled;
    
    if (isDisabled) {
        color = '#bfbfbf';
    } else {
        const loadRatio = getLinkLoad(link.id);
        const congestionState = congestionStates.get(link.id);
        
        if (loadRatio > 0.85) {
            color = '#ff4d4f';
        } else if (loadRatio > 0.6) {
            color = '#faad14';
        }
        
        if (congestionState) {
            const flash = Math.sin(Date.now() / 100) > 0;
            if (flash) {
                color = '#ff0000';
            }
        }
    }
    
    if (selectedLink && selectedLink.id === link.id) {
        lineWidth += 2;
    }
    
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    
    if (isDisabled) {
        ctx.setLineDash([8, 6]);
    }
    
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    
    if (isDisabled) {
        ctx.setLineDash([]);
    }
    
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    
    const reservationRatio = link.reservationRatio || 0;
    let label;
    if (isDisabled) {
        label = '已禁用';
    } else if (reservationRatio > 0) {
        const reservedLoad = getReservedPoolLoad(link.id);
        const bestEffortLoad = getBestEffortPoolLoad(link.id);
        label = `${link.bandwidth}Mbps R:${(reservedLoad * 100).toFixed(0)}% B:${(bestEffortLoad * 100).toFixed(0)}%`;
    } else {
        const loadRatio = getLinkLoad(link.id);
        label = `${link.bandwidth}Mbps/${link.delay}ms ${(loadRatio * 100).toFixed(0)}%`;
    }
    
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = isDisabled ? '#d9d9d9' : '#999';
    ctx.lineWidth = 1;
    
    ctx.font = '10px -apple-system, sans-serif';
    const textWidth = ctx.measureText(label).width;
    
    ctx.fillRect(midX - textWidth/2 - 4, midY - 7, textWidth + 8, 14);
    ctx.strokeRect(midX - textWidth/2 - 4, midY - 7, textWidth + 8, 14);
    
    ctx.fillStyle = isDisabled ? '#bfbfbf' : '#666';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, midX, midY);

    if (!isDisabled && reservationRatio > 0) {
        const reservedBw = link.bandwidth * reservationRatio / 100;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const offsetDist = 12;
        const tagX = midX + nx * offsetDist;
        const tagY = midY + ny * offsetDist;
        
        ctx.font = '9px -apple-system, sans-serif';
        ctx.fillStyle = '#722ed1';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`预留${reservationRatio}%(${reservedBw}M)`, tagX, tagY);
    }
}

function drawTemporaryLink() {
    if (!linkStartDevice) return;
    
    ctx.strokeStyle = '#1890ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    
    ctx.beginPath();
    ctx.moveTo(linkStartDevice.x, linkStartDevice.y);
    ctx.lineTo(mousePos.x, mousePos.y);
    ctx.stroke();
    
    ctx.setLineDash([]);
}

function drawPacket(packet) {
    const pos = getPacketPosition(packet);
    
    if (packet.isLost) {
        const alpha = 1 - (packet.lostAnimation / 500);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 2;
        
        const size = 6;
        ctx.beginPath();
        ctx.moveTo(pos.x - size, pos.y - size);
        ctx.lineTo(pos.x + size, pos.y + size);
        ctx.moveTo(pos.x + size, pos.y - size);
        ctx.lineTo(pos.x - size, pos.y + size);
        ctx.stroke();
        ctx.restore();
        return;
    }
    
    const flow = trafficFlows.find(f => f.id === packet.flowId);
    const isPriority = flow && flow.priority === 'priority';
    
    ctx.fillStyle = isPriority ? '#722ed1' : '#1890ff';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, isPriority ? 5 : 4, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function setupUIEvents() {
    document.getElementById('zoomIn').addEventListener('click', () => {
        scale = Math.min(maxScale, scale * 1.2);
        updateZoomLevel();
    });
    
    document.getElementById('zoomOut').addEventListener('click', () => {
        scale = Math.max(minScale, scale / 1.2);
        updateZoomLevel();
    });
    
    document.getElementById('resetView').addEventListener('click', () => {
        scale = 1;
        offset = { x: 0, y: 0 };
        updateZoomLevel();
    });
    
    document.getElementById('injectBtn').addEventListener('click', () => {
        if (isPlayback) {
            addLog('回放模式下无法注入新流量', 'warning');
            return;
        }
        const srcId = parseInt(document.getElementById('srcDevice').value);
        const dstId = parseInt(document.getElementById('dstDevice').value);
        const dataSize = parseFloat(document.getElementById('dataSize').value);
        const rate = parseFloat(document.getElementById('sendRate').value);
        const priority = document.getElementById('trafficPriority').value;
        
        if (!srcId || !dstId) {
            alert('请选择源设备和目的设备');
            return;
        }
        
        if (srcId === dstId) {
            alert('源设备和目的设备不能相同');
            return;
        }
        
        injectTraffic(srcId, dstId, dataSize, rate, priority);
    });
    
    document.getElementById('routingDevice').addEventListener('change', updateRoutingTableDisplay);
    
    document.getElementById('addManualRoute').addEventListener('click', () => {
        const src = parseInt(document.getElementById('manualSrc').value);
        const dst = parseInt(document.getElementById('manualDst').value);
        const nextHop = parseInt(document.getElementById('manualNextHop').value);
        
        if (!src || !dst || !nextHop) {
            alert('请完整填写手动路由信息');
            return;
        }
        
        if (src === dst) {
            alert('源和目的不能相同');
            return;
        }
        
        manualRoutes = manualRoutes.filter(r => !(r.src === src && r.dst === dst));
        manualRoutes.push({ src, dst, nextHop });
        
        recalculateRoutes();
    });
    
    document.getElementById('exportBtn').addEventListener('click', exportTopology);
    
    document.getElementById('importBtn').addEventListener('click', () => {
        document.getElementById('importFile').click();
    });
    
    document.getElementById('restoreAllBtn').addEventListener('click', restoreAllLinks);
    
    document.getElementById('batchFaultBtn').addEventListener('click', toggleBatchFaultMode);
    
    document.getElementById('importFile').addEventListener('change', importTopology);
}

function setupModalEvents() {
    const modal = document.getElementById('linkConfigModal');
    
    document.getElementById('cancelLinkConfig').addEventListener('click', () => {
        modal.classList.remove('show');
    });
    
    document.getElementById('confirmLinkConfig').addEventListener('click', confirmLinkConfig);
    
    document.getElementById('linkReservation').addEventListener('input', (e) => {
        document.getElementById('linkReserveLabel').textContent = e.target.value + '%';
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('show');
        }
    });
}

let pendingLinkConfig = null;

function showLinkConfigModal(fromDevice, toDevice) {
    pendingLinkConfig = { from: fromDevice, to: toDevice };
    document.getElementById('linkBandwidth').value = 100;
    document.getElementById('linkDelay').value = 10;
    document.getElementById('linkReservation').value = 0;
    document.getElementById('linkReserveLabel').textContent = '0%';
    document.getElementById('linkConfigModal').classList.add('show');
}

function confirmLinkConfig() {
    if (!pendingLinkConfig) return;
    
    const bandwidth = parseInt(document.getElementById('linkBandwidth').value);
    const delay = parseInt(document.getElementById('linkDelay').value);
    const reservationRatio = parseInt(document.getElementById('linkReservation').value);
    
    if (bandwidth < 1 || bandwidth > 10000) {
        alert('带宽范围: 1-10000 Mbps');
        return;
    }
    
    if (delay < 1 || delay > 500) {
        alert('延迟范围: 1-500 ms');
        return;
    }
    
    addLink(pendingLinkConfig.from.id, pendingLinkConfig.to.id, bandwidth, delay, reservationRatio);
    
    document.getElementById('linkConfigModal').classList.remove('show');
    pendingLinkConfig = null;
}

function setupContextMenu() {
    const menu = document.getElementById('contextMenu');
    let contextTarget = null;
    
    menu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (!action || !contextTarget) return;
        
        if (action === 'delete') {
            if (contextTarget.type) {
                deleteDevice(contextTarget.id);
            } else {
                deleteLink(contextTarget.id);
            }
        }
        
        hideContextMenu();
    });
    
    window.showContextMenu = function(x, y, target) {
        contextTarget = target;
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.classList.add('show');
    };
    
    window.hideContextMenu = function() {
        menu.classList.remove('show');
        contextTarget = null;
    };
}

function updateZoomLevel() {
    document.getElementById('zoomLevel').textContent = Math.round(scale * 100) + '%';
}

function updateDeviceCount() {
    document.getElementById('deviceCount').textContent = `设备: ${devices.length}/${MAX_DEVICES}`;
}

function updateDeviceSelects() {
    const selects = ['srcDevice', 'dstDevice', 'routingDevice', 'manualSrc', 'manualDst', 'manualNextHop'];
    
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        const currentValue = select.value;
        
        select.innerHTML = '<option value="">请选择</option>';
        
        devices.forEach(d => {
            const option = document.createElement('option');
            option.value = d.id;
            option.textContent = d.name;
            select.appendChild(option);
        });
        
        if (currentValue && devices.find(d => d.id == currentValue)) {
            select.value = currentValue;
        }
    });
    
    updateScenarioDeviceSelects();
}

function updatePropertyPanel() {
    const panel = document.getElementById('propertyPanel');
    
    if (selectedDevice) {
        panel.innerHTML = `
            <div class="prop-row">
                <span class="prop-label">名称</span>
                <input type="text" id="propName" value="${selectedDevice.name}" class="prop-input">
            </div>
            <div class="prop-row">
                <span class="prop-label">类型</span>
                <select id="propType" class="prop-input">
                    <option value="router" ${selectedDevice.type === 'router' ? 'selected' : ''}>路由器</option>
                    <option value="switch" ${selectedDevice.type === 'switch' ? 'selected' : ''}>交换机</option>
                    <option value="host" ${selectedDevice.type === 'host' ? 'selected' : ''}>终端主机</option>
                </select>
            </div>
            <div class="prop-row">
                <span class="prop-label">位置</span>
                <span class="prop-value">(${Math.round(selectedDevice.x)}, ${Math.round(selectedDevice.y)})</span>
            </div>
            <div class="prop-row">
                <span class="prop-label">关联链路</span>
                <span class="prop-value">${getDeviceLinkCount(selectedDevice.id)}</span>
            </div>
        `;
        
        document.getElementById('propName').addEventListener('change', (e) => {
            selectedDevice.name = e.target.value;
            updateDeviceSelects();
        });
        
        document.getElementById('propType').addEventListener('change', (e) => {
            selectedDevice.type = e.target.value;
        });
    } else if (selectedLink) {
        const fromDevice = devices.find(d => d.id === selectedLink.from);
        const toDevice = devices.find(d => d.id === selectedLink.to);
        const loadRatio = (getLinkLoad(selectedLink.id) * 100).toFixed(1);
        const isEnabled = selectedLink.enabled;
        const reservationRatio = selectedLink.reservationRatio || 0;
        const reservedBw = (selectedLink.bandwidth * reservationRatio / 100).toFixed(0);
        const bestEffortBw = (selectedLink.bandwidth * (100 - reservationRatio) / 100).toFixed(0);
        const reservedLoad = reservationRatio > 0 ? (getReservedPoolLoad(selectedLink.id) * 100).toFixed(1) : '-';
        const bestEffortLoad = reservationRatio > 0 ? (getBestEffortPoolLoad(selectedLink.id) * 100).toFixed(1) : '-';
        const qosStats = getLinkQoSStats(selectedLink.id);
        
        panel.innerHTML = `
            <div class="prop-row">
                <span class="prop-label">链路ID</span>
                <span class="prop-value">#${selectedLink.id}</span>
            </div>
            <div class="prop-row">
                <span class="prop-label">端点A</span>
                <span class="prop-value">${fromDevice ? fromDevice.name : '未知'}</span>
            </div>
            <div class="prop-row">
                <span class="prop-label">端点B</span>
                <span class="prop-value">${toDevice ? toDevice.name : '未知'}</span>
            </div>
            <div class="prop-row">
                <span class="prop-label">带宽 (Mbps)</span>
                <input type="number" id="propBandwidth" value="${selectedLink.bandwidth}" class="prop-input" min="1" max="10000" ${isEnabled ? '' : 'disabled'}>
            </div>
            <div class="prop-row">
                <span class="prop-label">延迟 (ms)</span>
                <input type="number" id="propDelay" value="${selectedLink.delay}" class="prop-input" min="1" max="500" ${isEnabled ? '' : 'disabled'}>
            </div>
            <div class="prop-row">
                <span class="prop-label">当前负载</span>
                <span class="prop-value">${isEnabled ? loadRatio + '%' : '-'}</span>
            </div>
            <div class="prop-row qos-section-title">
                <span class="prop-label" style="font-weight:500;color:#722ed1;">QoS带宽预留</span>
            </div>
            <div class="prop-row">
                <span class="prop-label">预留比例</span>
                <select id="propReservationRatio" class="prop-input" ${isEnabled ? '' : 'disabled'}>
                    ${[0,5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80].map(v => 
                        `<option value="${v}" ${v === reservationRatio ? 'selected' : ''}>${v}%</option>`
                    ).join('')}
                </select>
            </div>
            <div class="prop-row">
                <span class="prop-label">预留池带宽</span>
                <span class="prop-value">${reservedBw} Mbps</span>
            </div>
            <div class="prop-row">
                <span class="prop-label">尽力池带宽</span>
                <span class="prop-value">${bestEffortBw} Mbps</span>
            </div>
            ${reservationRatio > 0 ? `
            <div class="prop-row">
                <span class="prop-label">预留池负载</span>
                <span class="prop-value" style="color:${parseFloat(reservedLoad) > 85 ? '#ff4d4f' : '#333'}">${reservedLoad}%</span>
            </div>
            <div class="prop-row">
                <span class="prop-label">尽力池负载</span>
                <span class="prop-value" style="color:${parseFloat(bestEffortLoad) > 85 ? '#ff4d4f' : '#333'}">${bestEffortLoad}%</span>
            </div>
            ` : ''}
            ${qosStats ? `
            <div class="prop-row">
                <span class="prop-label">优先流量</span>
                <span class="prop-value">${qosStats.priorityCount}条 / ${qosStats.priorityRate.toFixed(1)}Mbps</span>
            </div>
            <div class="prop-row">
                <span class="prop-label">普通流量</span>
                <span class="prop-value">${qosStats.normalCount}条 / ${qosStats.normalRate.toFixed(1)}Mbps</span>
            </div>
            ` : ''}
            <div class="prop-row switch-row">
                <span class="prop-label">链路状态</span>
                <div class="switch ${isEnabled ? 'on' : 'off'}" id="linkSwitch">
                    <div class="switch-handle"></div>
                </div>
            </div>
            <div class="prop-row">
                <span class="prop-value" style="color: ${isEnabled ? '#52c41a' : '#ff4d4f'}; font-weight: 500;">
                    ${isEnabled ? '正常运行' : '已禁用'}
                </span>
            </div>
        `;
        
        document.getElementById('propBandwidth').addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            if (val >= 1 && val <= 10000) {
                selectedLink.bandwidth = val;
                recalculateRoutes();
            }
        });
        
        document.getElementById('propDelay').addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            if (val >= 1 && val <= 500) {
                selectedLink.delay = val;
                recalculateRoutes();
            }
        });
        
        document.getElementById('propReservationRatio').addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            selectedLink.reservationRatio = val;
            updatePropertyPanel();
            updateLinkCongestion();
        });
        
        document.getElementById('linkSwitch').addEventListener('click', () => {
            toggleLinkEnabled(selectedLink.id);
        });
    } else {
        panel.innerHTML = '<p class="hint">请选择设备或链路查看属性</p>';
    }
    
    const inputs = panel.querySelectorAll('input, select');
    inputs.forEach(input => {
        input.style.width = '120px';
        input.style.padding = '2px 6px';
        input.style.fontSize = '12px';
        input.style.border = '1px solid #d9d9d9';
        input.style.borderRadius = '3px';
    });
}

function getDeviceLinkCount(deviceId) {
    return links.filter(l => l.from === deviceId || l.to === deviceId).length;
}

function updateRoutingTableDisplay() {
    const deviceId = parseInt(document.getElementById('routingDevice').value);
    const table = document.getElementById('routingTable');
    
    if (!deviceId) {
        table.innerHTML = '<p class="hint">请选择设备</p>';
        return;
    }
    
    let html = '';
    
    devices.forEach(dest => {
        if (dest.id === deviceId) return;
        
        const path = getPath(deviceId, dest.id);
        const hasManualRoute = manualRoutes.some(r => r.src === deviceId && r.dst === dest.id);
        
        if (!path) {
            html += `<div class="routing-row unreachable ${hasManualRoute ? 'manual' : ''}">
                <span class="dest">${dest.name}</span>
                <span class="next-hop">不可达</span>
                <span class="delay">-</span>
            </div>`;
        } else {
            const nextHopId = path.nodes[1];
            const nextHopDevice = devices.find(d => d.id === nextHopId);
            html += `<div class="routing-row ${hasManualRoute ? 'manual' : ''}">
                <span class="dest">${dest.name}</span>
                <span class="next-hop">${nextHopDevice ? nextHopDevice.name : '-'}</span>
                <span class="delay">${path.totalDelay}ms</span>
            </div>`;
        }
    });
    
    table.innerHTML = html || '<p class="hint">无其他设备</p>';
}

function updateManualRouteList() {
    const list = document.getElementById('manualRouteList');
    
    if (manualRoutes.length === 0) {
        list.innerHTML = '<p class="hint" style="font-size:12px;color:#999;">暂无手动路由</p>';
        return;
    }
    
    let html = '';
    manualRoutes.forEach((route, index) => {
        const src = devices.find(d => d.id === route.src);
        const dst = devices.find(d => d.id === route.dst);
        const nextHop = devices.find(d => d.id === route.nextHop);
        
        html += `<div class="manual-route-item">
            <span>${src?.name || '-'} → ${dst?.name || '-'}: ${nextHop?.name || '-'}</span>
            <span class="delete-btn" onclick="removeManualRoute(${index})">×</span>
        </div>`;
    });
    
    list.innerHTML = html;
}

window.removeManualRoute = function(index) {
    manualRoutes.splice(index, 1);
    recalculateRoutes();
};

function updateTrafficList() {
    const list = document.getElementById('trafficList');
    const countSpan = document.getElementById('trafficCount');
    
    countSpan.textContent = trafficFlows.length;
    
    if (trafficFlows.length === 0) {
        list.innerHTML = '<p class="hint" style="font-size:12px;color:#999;">暂无活跃流量</p>';
        return;
    }
    
    let html = '';
    trafficFlows.forEach(flow => {
        const src = devices.find(d => d.id === flow.srcId);
        const dst = devices.find(d => d.id === flow.dstId);
        const progress = Math.min(100, (flow.sentPackets / flow.totalPackets) * 100);
        const statusText = flow.paused ? '等待恢复' : `${(flow.rate/1000000).toFixed(1)}Mbps`;
        const statusColor = flow.paused ? '#faad14' : '#999';
        const itemClass = flow.paused ? 'traffic-item paused' : 'traffic-item';
        const priorityLabel = flow.priority === 'priority' ? '<span style="color:#722ed1;font-size:10px;">[优先]</span>' : '<span style="color:#999;font-size:10px;">[普通]</span>';
        const demotedLabel = flow.demoted ? '<span style="color:#faad14;font-size:10px;">[已降级]</span>' : '';
        
        html += `<div class="${itemClass}">
            <div>
                <div>${priorityLabel}${demotedLabel} ${src?.name || '-'} → ${dst?.name || '-'}</div>
                <div style="font-size:11px;color:${statusColor};">${statusText}</div>
            </div>
            <div style="flex:1;margin-left:10px;">
                <div class="progress">
                    <div class="progress-bar" style="width:${progress}%"></div>
                </div>
            </div>
        </div>`;
    });
    
    list.innerHTML = html;
}

function updateTrafficProgress() {
    const items = document.querySelectorAll('.traffic-item .progress-bar');
    if (items.length !== trafficFlows.length) {
        updateTrafficList();
        return;
    }
    
    items.forEach((bar, i) => {
        const flow = trafficFlows[i];
        if (flow) {
            const progress = Math.min(100, (flow.sentPackets / flow.totalPackets) * 100);
            bar.style.width = progress + '%';
        }
    });
}

function updateFaultStats() {
    const disabledCountEl = document.getElementById('disabledLinkCount');
    const totalFaultEl = document.getElementById('totalFaultCount');
    const pathSwitchEl = document.getElementById('pathSwitchCount');
    const pausedFlowEl = document.getElementById('pausedFlowCount');
    
    if (disabledCountEl) disabledCountEl.textContent = faultStats.disabledLinkCount;
    if (totalFaultEl) totalFaultEl.textContent = faultStats.totalFaultCount;
    if (pathSwitchEl) pathSwitchEl.textContent = faultStats.pathSwitchCount;
    if (pausedFlowEl) pausedFlowEl.textContent = faultStats.pausedFlowCount;
}

function updateQoSStatsPanel() {
    const container = document.getElementById('qosStatsContent');
    if (!container) return;

    if (links.length === 0) {
        container.innerHTML = '<p class="hint">暂无链路数据</p>';
        return;
    }

    let html = '';
    links.forEach(link => {
        if (!link.enabled) return;
        const from = devices.find(d => d.id === link.from);
        const to = devices.find(d => d.id === link.to);
        const reservationRatio = link.reservationRatio || 0;
        const qosStats = getLinkQoSStats(link.id);

        if (!qosStats && reservationRatio === 0) return;

        const reservedBw = (link.bandwidth * reservationRatio / 100).toFixed(0);
        const bestEffortBw = (link.bandwidth * (100 - reservationRatio) / 100).toFixed(0);

        html += `<div class="qos-link-item">
            <div class="qos-link-header">
                <span class="qos-link-name">${from?.name || '?'} - ${to?.name || '?'}</span>
                <span class="qos-link-bw">${link.bandwidth}Mbps</span>
            </div>`;

        if (reservationRatio > 0) {
            const reservedUsage = qosStats ? qosStats.reservedPoolUsage.toFixed(1) : '0.0';
            const bestEffortUsage = qosStats ? qosStats.bestEffortPoolUsage.toFixed(1) : '0.0';
            html += `<div class="qos-pool-row">
                <span class="qos-pool-label qos-reserved">预留池</span>
                <span class="qos-pool-bw">${reservedBw}M</span>
                <div class="qos-pool-bar">
                    <div class="qos-pool-bar-fill qos-reserved-fill" style="width:${Math.min(100, parseFloat(reservedUsage))}%"></div>
                </div>
                <span class="qos-pool-pct">${reservedUsage}%</span>
            </div>
            <div class="qos-pool-row">
                <span class="qos-pool-label qos-besteffort">尽力池</span>
                <span class="qos-pool-bw">${bestEffortBw}M</span>
                <div class="qos-pool-bar">
                    <div class="qos-pool-bar-fill qos-besteffort-fill" style="width:${Math.min(100, parseFloat(bestEffortUsage))}%"></div>
                </div>
                <span class="qos-pool-pct">${bestEffortUsage}%</span>
            </div>`;
        } else {
            html += `<div class="qos-pool-row">
                <span class="qos-pool-label">未配置预留</span>
            </div>`;
        }

        if (qosStats) {
            html += `<div class="qos-flow-counts">
                <span class="qos-priority-count">优先: ${qosStats.priorityCount}条</span>
                <span class="qos-normal-count">普通: ${qosStats.normalCount}条</span>
            </div>`;
        }

        html += `</div>`;
    });

    container.innerHTML = html || '<p class="hint">暂无QoS配置</p>';
}

function updatePartitionPanel() {
    const statusEl = document.getElementById('partitionStatus');
    const statusTextEl = document.getElementById('partitionStatusText');
    const listEl = document.getElementById('partitionList');
    const historyEl = document.getElementById('partitionHistoryList');
    
    if (!statusEl || !listEl) return;
    
    const partitionCount = partitions.length;
    const isSplit = partitionCount > 1;
    
    statusEl.className = 'partition-status' + (isSplit ? ' split' : '');
    statusTextEl.textContent = isSplit ? `网络分裂为 ${partitionCount} 个分区` : '网络全连通';
    
    if (partitionCount === 0) {
        listEl.innerHTML = '<p class="hint" style="font-size:11px;color:#999;text-align:center;padding:8px 0;">暂无设备</p>';
    } else if (partitionCount === 1) {
        listEl.innerHTML = '';
    } else {
        let html = '';
        partitions.forEach(partition => {
            const deviceNames = partition.deviceIds.map(id => getDeviceName(id)).join(', ');
            html += `
                <div class="partition-item" style="border-left-color: ${partition.color};">
                    <div class="partition-item-header">
                        <span class="partition-item-name">
                            <span class="partition-color-dot" style="background: ${partition.color};"></span>
                            分区 ${partition.id}
                        </span>
                        <span class="partition-item-count">${partition.deviceIds.length} 台设备</span>
                    </div>
                    <div class="partition-item-devices">${escapeHtml(deviceNames)}</div>
                </div>
            `;
        });
        listEl.innerHTML = html;
    }
    
    if (historyEl) {
        if (partitionChangeHistory.length === 0) {
            historyEl.innerHTML = '<p class="hint" style="font-size:11px;color:#999;text-align:center;padding:8px 0;">暂无变更记录</p>';
        } else {
            let html = '';
            partitionChangeHistory.forEach(event => {
                const time = new Date(event.timestamp).toLocaleTimeString();
                const isIncrease = event.newCount > event.oldCount;
                const itemClass = isIncrease ? 'split-increase' : 'split-decrease';
                const arrow = isIncrease ? '↑' : '↓';
                
                const actionLabels = {
                    'enable_link': '链路启用',
                    'disable_link': '链路禁用',
                    'add_link': '添加链路',
                    'delete_link': '删除链路',
                    'add_device': '添加设备',
                    'delete_device': '删除设备',
                    'load_topology': '加载拓扑',
                    'import_topology': '导入拓扑',
                    'config_generated': '配置生成'
                };
                
                const actionLabel = actionLabels[event.triggerAction] || event.triggerAction || '未知';
                let triggerText = '';
                
                if (event.triggerLinkName) {
                    triggerText = `触发: ${escapeHtml(event.triggerLinkName)} (${actionLabel})`;
                } else if (event.triggerAction) {
                    triggerText = `触发: ${actionLabel}`;
                }
                
                html += `
                    <div class="partition-history-item ${itemClass}">
                        <div class="partition-history-time">${time}</div>
                        <div class="partition-history-detail">
                            分区数: ${event.oldCount} → ${event.newCount} ${arrow}
                        </div>
                        ${triggerText ? `<div class="partition-history-trigger">${triggerText}</div>` : ''}
                    </div>
                `;
            });
            historyEl.innerHTML = html;
        }
    }
}

function exportTopology() {
    const data = {
        version: '1.0',
        devices: devices.map(d => ({
            id: d.id,
            type: d.type,
            name: d.name,
            x: d.x,
            y: d.y
        })),
        links: links.map(l => ({
            id: l.id,
            from: l.from,
            to: l.to,
            bandwidth: l.bandwidth,
            delay: l.delay,
            enabled: l.enabled,
            reservationRatio: l.reservationRatio || 0
        })),
        manualRoutes: manualRoutes
    };
    
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `topology_${Date.now()}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
    addLog('拓扑已导出', 'success');
}

function importTopology(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const data = JSON.parse(event.target.result);
            const errors = validateTopology(data);
            
            if (errors.length > 0) {
                alert('导入失败:\n' + errors.join('\n'));
                return;
            }
            
            devices = data.devices.map(d => ({ ...d }));
            links = data.links.map(l => ({ 
                ...l, 
                enabled: l.enabled !== undefined ? l.enabled : true,
                reservationRatio: l.reservationRatio || 0
            }));
            manualRoutes = data.manualRoutes || [];
            
            deviceIdCounter = Math.max(...devices.map(d => d.id), 0) + 1;
            linkIdCounter = Math.max(...links.map(l => l.id), 0) + 1;
            
            trafficFlows = [];
            packets = [];
            congestionStates.clear();
            
            faultStats = {
                disabledLinkCount: links.filter(l => !l.enabled).length,
                totalFaultCount: 0,
                pathSwitchCount: 0,
                pausedFlowCount: 0
            };
            
            selectedDevice = null;
            selectedLink = null;
            
            updateDeviceCount();
            updateDeviceSelects();
            updatePropertyPanel();
            recalculateRoutes();
            updateTrafficList();
            updateFaultStats();
            triggerPartitionRecalculation(null, 'import_topology');
            
            addLog('拓扑导入成功', 'success');
            
        } catch (err) {
            alert('导入失败: JSON格式错误');
        }
        
        e.target.value = '';
    };
    
    reader.readAsText(file);
}

function validateTopology(data) {
    const errors = [];
    
    if (!data.devices || !Array.isArray(data.devices)) {
        errors.push('- 缺少 devices 数组');
        return errors;
    }
    
    if (!data.links || !Array.isArray(data.links)) {
        errors.push('- 缺少 links 数组');
        return errors;
    }
    
    if (data.devices.length > MAX_DEVICES) {
        errors.push(`- 设备数量超过上限 (${data.devices.length}/${MAX_DEVICES})`);
    }
    
    const deviceIds = new Set();
    data.devices.forEach((d, i) => {
        if (!d.id || !d.type || !d.name || d.x === undefined || d.y === undefined) {
            errors.push(`- 设备 #${i}: 缺少必要字段 (id, type, name, x, y)`);
        }
        if (deviceIds.has(d.id)) {
            errors.push(`- 设备 #${i}: 重复的ID ${d.id}`);
        }
        deviceIds.add(d.id);
        if (!['router', 'switch', 'host'].includes(d.type)) {
            errors.push(`- 设备 #${d.id}: 无效的类型 ${d.type}`);
        }
    });
    
    data.links.forEach((l, i) => {
        if (!l.from || !l.to) {
            errors.push(`- 链路 #${i}: 缺少端点信息`);
            return;
        }
        if (!deviceIds.has(l.from)) {
            errors.push(`- 链路 #${l.id || i}: 引用不存在的设备 ${l.from}`);
        }
        if (!deviceIds.has(l.to)) {
            errors.push(`- 链路 #${l.id || i}: 引用不存在的设备 ${l.to}`);
        }
        if (l.bandwidth < 1 || l.bandwidth > 10000) {
            errors.push(`- 链路 #${l.id || i}: 带宽超出范围 (${l.bandwidth})`);
        }
        if (l.delay < 1 || l.delay > 500) {
            errors.push(`- 链路 #${l.id || i}: 延迟超出范围 (${l.delay})`);
        }
    });
    
    if (data.manualRoutes) {
        data.manualRoutes.forEach((r, i) => {
            if (!deviceIds.has(r.src)) {
                errors.push(`- 手动路由 #${i}: 引用不存在的源设备 ${r.src}`);
            }
            if (!deviceIds.has(r.dst)) {
                errors.push(`- 手动路由 #${i}: 引用不存在的目的设备 ${r.dst}`);
            }
            if (!deviceIds.has(r.nextHop)) {
                errors.push(`- 手动路由 #${i}: 引用不存在的下一跳设备 ${r.nextHop}`);
            }
        });
    }
    
    return errors;
}

let scenarios = [];
let selectedScenarioId = null;
let currentRunningScenario = null;
let scenarioIsRunning = false;
let scenarioStartTime = 0;
let scenarioElapsed = 0;
let scenarioTimer = null;
let scenarioSamplingTimer = null;
let scenarioTriggeredEvents = 0;
let scenarioFlowResults = [];
let scenarioLinkSamples = new Map();
let scenarioReportData = null;
let scenarioIdCounter = 1;
let reportCollapsed = false;
let scenarioEventIdSet = new Set();

const MAX_SCENARIOS = 5;

function setupScenarioEvents() {
    document.getElementById('createScenarioBtn').addEventListener('click', createScenario);
    document.getElementById('closeScenarioEditor').addEventListener('click', closeScenarioEditor);
    document.getElementById('addEventBtn').addEventListener('click', addEventToScenario);
    document.getElementById('runScenarioBtn').addEventListener('click', startScenario);
    document.getElementById('stopScenarioBtn').addEventListener('click', stopScenario);
    document.getElementById('deleteScenarioBtn').addEventListener('click', deleteScenario);
    document.getElementById('exportReportBtn').addEventListener('click', exportReport);
    document.getElementById('toggleReportBtn').addEventListener('click', toggleReport);
}

function updateScenarioDeviceSelects() {
    const selects = ['eventSrc', 'eventDst'];
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        const currentValue = select.value;
        select.innerHTML = '<option value="">请选择</option>';
        devices.forEach(d => {
            const option = document.createElement('option');
            option.value = d.id;
            option.textContent = d.name;
            select.appendChild(option);
        });
        if (currentValue && devices.find(d => d.id == currentValue)) {
            select.value = currentValue;
        }
    });
}

function createScenario() {
    const name = document.getElementById('scenarioName').value.trim();
    if (!name) {
        alert('请输入场景名称');
        return;
    }
    if (scenarios.length >= MAX_SCENARIOS) {
        alert(`最多只能保存 ${MAX_SCENARIOS} 个场景`);
        return;
    }
    const scenario = {
        id: scenarioIdCounter++,
        name: name,
        events: []
    };
    scenarios.push(scenario);
    document.getElementById('scenarioName').value = '';
    renderScenarioList();
    openScenarioEditor(scenario.id);
}

function renderScenarioList() {
    const list = document.getElementById('scenarioList');
    if (scenarios.length === 0) {
        list.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:10px 0;">暂无场景，点击"新建场景"创建</p>';
        return;
    }
    let html = '';
    scenarios.forEach(s => {
        html += `<div class="scenario-item ${s.id === selectedScenarioId ? 'active' : ''}" onclick="openScenarioEditor(${s.id})">
            <div class="scenario-item-info">
                <div class="scenario-item-name">${escapeHtml(s.name)}</div>
                <div class="scenario-item-count">${s.events.length} 个事件</div>
            </div>
        </div>`;
    });
    list.innerHTML = html;
}

function openScenarioEditor(scenarioId) {
    if (currentRunningScenario) {
        alert('场景运行中，不允许编辑其他场景');
        return;
    }
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (!scenario) return;
    selectedScenarioId = scenarioId;
    document.getElementById('editingScenarioName').textContent = scenario.name;
    document.getElementById('scenarioEditor').style.display = 'block';
    updateScenarioDeviceSelects();
    renderEventList();
    renderScenarioList();
}

function closeScenarioEditor() {
    if (currentRunningScenario) return;
    selectedScenarioId = null;
    document.getElementById('scenarioEditor').style.display = 'none';
    renderScenarioList();
}

function deleteScenario() {
    if (currentRunningScenario) return;
    if (!selectedScenarioId) return;
    if (!confirm('确定要删除这个场景吗？')) return;
    scenarios = scenarios.filter(s => s.id !== selectedScenarioId);
    closeScenarioEditor();
}

function addEventToScenario() {
    if (!selectedScenarioId) return;
    const scenario = scenarios.find(s => s.id === selectedScenarioId);
    if (!scenario) return;

    const time = parseFloat(document.getElementById('eventTime').value);
    const srcId = parseInt(document.getElementById('eventSrc').value);
    const dstId = parseInt(document.getElementById('eventDst').value);
    const dataSize = parseFloat(document.getElementById('eventDataSize').value);
    const rate = parseFloat(document.getElementById('eventRate').value);
    const priority = document.getElementById('eventPriority').value;

    if (isNaN(time) || time < 0) {
        alert('请输入有效的触发时刻');
        return;
    }
    if (!srcId || !dstId) {
        alert('请选择源设备和目的设备');
        return;
    }
    if (srcId === dstId) {
        alert('源设备和目的设备不能相同');
        return;
    }
    if (!dataSize || dataSize <= 0) {
        alert('请输入有效的数据量');
        return;
    }
    if (!rate || rate <= 0) {
        alert('请输入有效的速率');
        return;
    }

    const event = {
        id: Date.now(),
        time: Math.round(time * 10) / 10,
        srcId: srcId,
        dstId: dstId,
        dataSize: dataSize,
        rate: rate,
        priority: priority || 'normal',
        triggered: false,
        flowId: null
    };
    scenario.events.push(event);
    scenario.events.sort((a, b) => a.time - b.time);
    renderEventList();
    renderScenarioList();
}

window.deleteEvent = function(eventId) {
    if (!selectedScenarioId) return;
    if (currentRunningScenario) return;
    const scenario = scenarios.find(s => s.id === selectedScenarioId);
    if (!scenario) return;
    scenario.events = scenario.events.filter(e => e.id !== eventId);
    renderEventList();
    renderScenarioList();
};

function renderEventList() {
    const list = document.getElementById('eventList');
    if (!selectedScenarioId) {
        list.innerHTML = '';
        return;
    }
    const scenario = scenarios.find(s => s.id === selectedScenarioId);
    if (!scenario || scenario.events.length === 0) {
        list.innerHTML = '<p class="hint" style="font-size:11px;color:#999;text-align:center;padding:8px 0;">暂无事件</p>';
        return;
    }
    let html = '';
    scenario.events.forEach((e) => {
        const src = devices.find(d => d.id === e.srcId);
        const dst = devices.find(d => d.id === e.dstId);
        const isRunning = currentRunningScenario !== null;
        const priorityLabel = e.priority === 'priority' ? '<span style="color:#722ed1;font-size:10px;">[优先]</span>' : '';
        html += `<div class="event-item">
            <div class="event-item-header">
                <span class="event-item-time">T+${e.time.toFixed(1)}s</span>
                ${isRunning ? '' : `<span class="event-item-delete" onclick="deleteEvent(${e.id})">×</span>`}
            </div>
            <div class="event-item-detail">
                ${priorityLabel}${src?.name || '-'} → ${dst?.name || '-'}<br>
                ${e.dataSize}KB @ ${e.rate}Mbps
            </div>
        </div>`;
    });
    list.innerHTML = html;
}

function startScenario() {
    if (currentRunningScenario || scenarioIsRunning) {
        alert('已有场景正在运行');
        return;
    }
    if (!selectedScenarioId) return;
    const scenario = scenarios.find(s => s.id === selectedScenarioId);
    if (!scenario) return;
    if (scenario.events.length === 0) {
        alert('场景中没有事件');
        return;
    }

    currentRunningScenario = scenario;
    scenarioIsRunning = true;
    scenarioStartTime = Date.now();
    scenarioElapsed = 0;
    scenarioTriggeredEvents = 0;
    scenarioFlowResults = [];
    scenarioLinkSamples = new Map();
    scenarioReportData = null;
    scenarioEventIdSet = new Set();

    scenario.events.forEach(e => {
        e.triggered = false;
        e.flowId = null;
        scenarioEventIdSet.add(e.id);
    });

    document.getElementById('runScenarioBtn').style.display = 'none';
    document.getElementById('stopScenarioBtn').style.display = 'inline-block';
    document.getElementById('scenarioProgress').style.display = 'block';
    document.getElementById('deleteScenarioBtn').style.display = 'none';

    updateScenarioProgress();

    scenarioTimer = setInterval(scenarioTick, 50);
    scenarioSamplingTimer = setInterval(scenarioSample, 100);

    addLog(`压测场景开始: ${scenario.name}`, 'info');
}

function scenarioTick() {
    if (!currentRunningScenario) return;
    scenarioElapsed = (Date.now() - scenarioStartTime) / 1000;

    currentRunningScenario.events.forEach(event => {
        if (!event.triggered && scenarioElapsed >= event.time) {
            event.triggered = true;
            scenarioTriggeredEvents++;
            
            if (!areDevicesInSamePartition(event.srcId, event.dstId)) {
                addLog(`压测事件失败: 源和目的不在同一分区 - ${getDeviceName(event.srcId)} → ${getDeviceName(event.dstId)}`, 'error');
                scenarioFlowResults.push({
                    eventId: event.id,
                    srcId: event.srcId,
                    dstId: event.dstId,
                    dataSize: event.dataSize,
                    rate: event.rate,
                    duration: 0,
                    lossRate: 100,
                    path: null,
                    failed: true,
                    failedReason: 'cross_partition'
                });
            } else {
                const success = injectTraffic(event.srcId, event.dstId, event.dataSize, event.rate, event.priority || 'normal');
                if (success) {
                    const flow = trafficFlows[trafficFlows.length - 1];
                    if (flow) {
                        event.flowId = flow.id;
                        flow.scenarioEventId = event.id;
                    }
                } else {
                    scenarioFlowResults.push({
                        eventId: event.id,
                        srcId: event.srcId,
                        dstId: event.dstId,
                        dataSize: event.dataSize,
                        rate: event.rate,
                        duration: 0,
                        lossRate: 100,
                        path: null,
                        failed: true,
                        failedReason: 'unreachable'
                    });
                }
            }
        }
    });

    checkScenarioCompleted();
    updateScenarioProgress();
}

function scenarioSample() {
    if (!currentRunningScenario) return;
    const sampleTime = scenarioElapsed;
    links.forEach(link => {
        if (!scenarioLinkSamples.has(link.id)) {
            scenarioLinkSamples.set(link.id, []);
        }
        const load = getLinkRequestedLoad(link.id);
        const reservationRatio = link.reservationRatio || 0;
        const reservedPoolLoad = reservationRatio > 0 ? getReservedPoolLoad(link.id) : 0;
        const bestEffortPoolLoad = reservationRatio > 0 ? getBestEffortPoolLoad(link.id) : load;
        scenarioLinkSamples.get(link.id).push({
            time: Math.round(sampleTime * 10) / 10,
            load: load,
            reservedPoolLoad: reservedPoolLoad,
            bestEffortPoolLoad: bestEffortPoolLoad
        });
    });
}

function checkScenarioCompleted() {
    if (!currentRunningScenario) return;
    const allTriggered = currentRunningScenario.events.every(e => e.triggered);
    if (!allTriggered) return;

    const allFlowsDone = trafficFlows.filter(f => 
        currentRunningScenario.events.some(e => e.flowId === f.id)
    ).length === 0;

    const pendingFlowResults = currentRunningScenario.events.filter(e => 
        e.flowId !== null && !scenarioFlowResults.some(r => r.eventId === e.id)
    );
    pendingFlowResults.forEach(() => {
    });

    if (allFlowsDone && pendingFlowResults.length === 0) {
        finishScenario();
    }
}

function finishScenario() {
    if (!currentRunningScenario) return;
    
    scenarioIsRunning = false;
    clearInterval(scenarioTimer);
    clearInterval(scenarioSamplingTimer);
    scenarioTimer = null;
    scenarioSamplingTimer = null;
    
    clearFlowScenarioMarkers();

    addLog(`压测场景完成: ${currentRunningScenario.name}`, 'success');
    generateReport();
    resetScenarioUI();
    currentRunningScenario = null;
    scenarioEventIdSet.clear();
}

function stopScenario() {
    if (!currentRunningScenario) return;
    
    scenarioIsRunning = false;
    clearInterval(scenarioTimer);
    clearInterval(scenarioSamplingTimer);
    scenarioTimer = null;
    scenarioSamplingTimer = null;

    const activeFlowIds = new Set(
        currentRunningScenario.events.filter(e => e.flowId !== null).map(e => e.flowId)
    );
    trafficFlows = trafficFlows.filter(f => !activeFlowIds.has(f.id));
    packets = packets.filter(p => !activeFlowIds.has(p.flowId));
    updateTrafficList();
    updateLinkCongestion();
    
    clearFlowScenarioMarkers();

    addLog(`压测场景中止: ${currentRunningScenario.name}`, 'warning');
    generateReport(true);
    resetScenarioUI();
    currentRunningScenario = null;
    scenarioEventIdSet.clear();
}

function clearFlowScenarioMarkers() {
    trafficFlows.forEach(flow => {
        if (flow.scenarioEventId) {
            delete flow.scenarioEventId;
        }
    });
}

function resetScenarioUI() {
    document.getElementById('runScenarioBtn').style.display = 'inline-block';
    document.getElementById('stopScenarioBtn').style.display = 'none';
    document.getElementById('scenarioProgress').style.display = 'none';
    document.getElementById('deleteScenarioBtn').style.display = 'inline-block';
}

function updateScenarioProgress() {
    if (!currentRunningScenario) return;
    const total = currentRunningScenario.events.length;
    const triggered = scenarioTriggeredEvents;
    const percent = total > 0 ? (triggered / total) * 100 : 0;
    document.getElementById('scenarioProgressBar').style.width = percent + '%';
    document.getElementById('scenarioProgressText').textContent = `${triggered}/${total} 事件`;
    document.getElementById('scenarioElapsed').textContent = scenarioElapsed.toFixed(1) + 's';
}

function recordFlowCompletion(flow) {
    if (!scenarioIsRunning) return;
    if (!currentRunningScenario) return;
    if (!flow.scenarioEventId) return;
    if (!scenarioEventIdSet.has(flow.scenarioEventId)) return;
    if (scenarioFlowResults.some(r => r.eventId === flow.scenarioEventId)) return;

    const event = currentRunningScenario.events.find(e => e.id === flow.scenarioEventId);
    if (!event) return;

    const duration = flow.endTime && flow.startTime ? (flow.endTime - flow.startTime) / 1000 : 0;
    const lossRate = flow.totalPackets > 0 ? (flow.lostPackets / flow.totalPackets) * 100 : 0;

    const linkIds = flow.path && flow.path.segments 
        ? flow.path.segments.map(seg => seg.link.id) 
        : [];
    
    scenarioFlowResults.push({
        eventId: event.id,
        srcId: event.srcId,
        dstId: event.dstId,
        dataSize: event.dataSize,
        rate: event.rate,
        priority: flow.priority || 'normal',
        demoted: flow.demoted || false,
        duration: duration,
        lossRate: lossRate,
        linkIds: linkIds,
        path: flow.path ? getPathNodeNames(flow.path) : null,
        failed: false,
        failedReason: null
    });
}

function generateReport(aborted = false) {
    if (!currentRunningScenario) return;

    const totalDuration = scenarioElapsed;
    const totalFlows = currentRunningScenario.events.length;

    const unreachableFlows = scenarioFlowResults.filter(r => r.failed && r.failedReason === 'unreachable').length;
    const crossPartitionFlows = scenarioFlowResults.filter(r => r.failed && r.failedReason === 'cross_partition').length;
    const completedFlows = scenarioFlowResults.filter(r => !r.failed).length;
    const totalLossRate = scenarioFlowResults.length > 0 
        ? (scenarioFlowResults.reduce((sum, r) => sum + r.lossRate, 0) / scenarioFlowResults.length)
        : 0;

    const linkStats = [];
    links.forEach(link => {
        const samples = scenarioLinkSamples.get(link.id) || [];
        if (samples.length === 0) return;
        const loads = samples.map(s => s.load);
        const peakLoad = Math.max(...loads);
        const avgLoad = loads.reduce((a, b) => a + b, 0) / loads.length;
        const congestedSamples = loads.filter(l => l > 1.0).length;
        const congestedDuration = congestedSamples * 0.1;

        const reservationRatio = link.reservationRatio || 0;
        const reservedPoolLoads = samples.map(s => s.reservedPoolLoad || 0);
        const bestEffortPoolLoads = samples.map(s => s.bestEffortPoolLoad || 0);
        const peakReservedPoolLoad = reservedPoolLoads.length > 0 ? Math.max(...reservedPoolLoads) : 0;
        const peakBestEffortPoolLoad = bestEffortPoolLoads.length > 0 ? Math.max(...bestEffortPoolLoads) : 0;

        const flowsOnLink = scenarioFlowResults.filter(r => 
            !r.failed && r.linkIds && r.linkIds.includes(link.id)
        );
        const linkLossRate = flowsOnLink.length > 0
            ? flowsOnLink.reduce((sum, r) => sum + r.lossRate, 0) / flowsOnLink.length
            : 0;

        linkStats.push({
            linkId: link.id,
            linkName: `${getDeviceName(link.from)} - ${getDeviceName(link.to)}`,
            bandwidth: link.bandwidth,
            reservationRatio: reservationRatio,
            peakLoad: peakLoad,
            avgLoad: avgLoad,
            congestedDuration: congestedDuration,
            lossRate: linkLossRate,
            flowCount: flowsOnLink.length,
            peakReservedPoolLoad: peakReservedPoolLoad,
            peakBestEffortPoolLoad: peakBestEffortPoolLoad,
            samples: samples
        });
    });
    linkStats.sort((a, b) => b.peakLoad - a.peakLoad);

    const flowDetails = [];
    currentRunningScenario.events.forEach(event => {
        const result = scenarioFlowResults.find(r => r.eventId === event.id);
        if (result) {
            flowDetails.push({
                eventId: event.id,
                time: event.time,
                src: getDeviceName(result.srcId),
                dst: getDeviceName(result.dstId),
                rate: result.rate,
                priority: result.priority || 'normal',
                demoted: result.demoted || false,
                duration: result.duration,
                lossRate: result.lossRate,
                path: result.path,
                failed: result.failed,
                failedReason: result.failedReason
            });
        } else {
            flowDetails.push({
                eventId: event.id,
                time: event.time,
                src: getDeviceName(event.srcId),
                dst: getDeviceName(event.dstId),
                rate: event.rate,
                duration: 0,
                lossRate: 100,
                path: null,
                failed: true,
                failedReason: 'aborted'
            });
        }
    });
    flowDetails.sort((a, b) => a.time - b.time);

    scenarioReportData = {
        scenarioName: currentRunningScenario.name,
        aborted: aborted,
        totalDuration: totalDuration,
        totalFlows: totalFlows,
        completedFlows: completedFlows,
        unreachableFlows: unreachableFlows,
        crossPartitionFlows: crossPartitionFlows,
        avgLossRate: totalLossRate,
        linkStats: linkStats,
        flowDetails: flowDetails,
        rawSamples: Object.fromEntries(scenarioLinkSamples),
        timestamp: Date.now()
    };

    renderReport();
}

function renderReport() {
    if (!scenarioReportData) return;

    document.getElementById('reportEmpty').style.display = 'none';
    document.getElementById('reportContainer').style.display = 'block';
    document.getElementById('reportScenarioName').textContent = scenarioReportData.scenarioName + 
        (scenarioReportData.aborted ? ' (已中止)' : '');

    const overview = document.getElementById('reportOverview');
    overview.innerHTML = `
        <div class="report-stat-row">
            <span class="report-stat-label">总时长</span>
            <span class="report-stat-value">${scenarioReportData.totalDuration.toFixed(1)}s</span>
        </div>
        <div class="report-stat-row">
            <span class="report-stat-label">注入流量</span>
            <span class="report-stat-value">${scenarioReportData.totalFlows}</span>
        </div>
        <div class="report-stat-row">
            <span class="report-stat-label">完成数</span>
            <span class="report-stat-value">${scenarioReportData.completedFlows}</span>
        </div>
        <div class="report-stat-row">
            <span class="report-stat-label">不可达失败</span>
            <span class="report-stat-value">${scenarioReportData.unreachableFlows}</span>
        </div>
        <div class="report-stat-row">
            <span class="report-stat-label">跨分区失败</span>
            <span class="report-stat-value">${scenarioReportData.crossPartitionFlows || 0}</span>
        </div>
        <div class="report-stat-row" style="grid-column: 1 / -1;">
            <span class="report-stat-label">全局平均丢包率</span>
            <span class="report-stat-value">${scenarioReportData.avgLossRate.toFixed(1)}%</span>
        </div>
    `;

    const linksEl = document.getElementById('reportLinks');
    if (scenarioReportData.linkStats.length === 0) {
        linksEl.innerHTML = '<p class="hint" style="font-size:11px;color:#999;text-align:center;">无数据</p>';
    } else {
        let html = '';
        scenarioReportData.linkStats.forEach(ls => {
            const peakPercent = Math.min(200, ls.peakLoad * 100);
            let barColor = '#52c41a';
            if (ls.peakLoad > 1.0) barColor = '#ff4d4f';
            else if (ls.peakLoad > 0.6) barColor = '#faad14';
            
            const reservationRatio = ls.reservationRatio || 0;
            let poolInfo = '';
            if (reservationRatio > 0) {
                const reservedPeak = (ls.peakReservedPoolLoad * 100).toFixed(1);
                const bestEffortPeak = (ls.peakBestEffortPoolLoad * 100).toFixed(1);
                poolInfo = `<span style="color:#722ed1;">预留池峰值: ${reservedPeak}%</span>
                            <span style="color:#fa8c16;">尽力池峰值: ${bestEffortPeak}%</span>`;
            }
            
            html += `<div class="report-link-item" style="display:block;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span class="report-link-name">${escapeHtml(ls.linkName)}</span>
                    <span class="report-link-stats">
                        <span>峰值: ${(ls.peakLoad * 100).toFixed(1)}%</span>
                        <span>均值: ${(ls.avgLoad * 100).toFixed(1)}%</span>
                        <span>拥塞: ${ls.congestedDuration.toFixed(1)}s</span>
                    </span>
                </div>
                ${poolInfo ? `<div class="report-link-pool-stats">${poolInfo}</div>` : ''}
                <div class="report-link-bar">
                    <div class="report-link-bar-fill" style="width:${peakPercent}%;background:${barColor};"></div>
                </div>
            </div>`;
        });
        linksEl.innerHTML = html;
    }

    const flowsEl = document.getElementById('reportFlows');
    if (scenarioReportData.flowDetails.length === 0) {
        flowsEl.innerHTML = '<p class="hint" style="font-size:11px;color:#999;text-align:center;">无数据</p>';
    } else {
        let html = '';
        scenarioReportData.flowDetails.forEach(fd => {
            const statusClass = fd.failed ? 'failed' : 'success';
            let statusText = '完成';
            if (fd.failed) {
                if (fd.failedReason === 'unreachable') {
                    statusText = '不可达';
                } else if (fd.failedReason === 'cross_partition') {
                    statusText = '跨分区';
                } else {
                    statusText = '已中止';
                }
            }
            const priorityLabel = fd.priority === 'priority' ? '<span style="color:#722ed1;font-size:10px;">[优先]</span>' : '<span style="color:#999;font-size:10px;">[普通]</span>';
            const demotedLabel = fd.demoted ? '<span style="color:#faad14;font-size:10px;">[已降级]</span>' : '';
            html += `<div class="report-flow-item">
                <div class="report-flow-item-header">
                    <span class="report-flow-name">${priorityLabel}${demotedLabel} T+${fd.time.toFixed(1)}s ${escapeHtml(fd.src)} → ${escapeHtml(fd.dst)}</span>
                    <span class="report-flow-status ${statusClass}">${statusText}</span>
                </div>
                <div class="report-flow-detail">
                    速率: ${fd.rate}Mbps | 耗时: ${fd.duration.toFixed(2)}s | 丢包率: ${fd.lossRate.toFixed(1)}%
                    ${fd.path ? `<br>路径: ${escapeHtml(fd.path)}` : ''}
                </div>
            </div>`;
        });
        flowsEl.innerHTML = html;
    }
}

function toggleReport() {
    reportCollapsed = !reportCollapsed;
    const container = document.getElementById('reportContainer');
    const btn = document.getElementById('toggleReportBtn');
    container.classList.toggle('report-collapsed', reportCollapsed);
    btn.textContent = reportCollapsed ? '展开' : '收起';
}

function exportReport() {
    if (!scenarioReportData) {
        alert('没有可导出的报告');
        return;
    }
    const json = JSON.stringify(scenarioReportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${scenarioReportData.scenarioName}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('报告已导出', 'success');
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

const API_BASE = '/api';

let topologyVersions = [];
let historyReports = [];
let currentViewedReport = null;
let compareResult = null;

async function apiRequest(url, options = {}) {
    try {
        const response = await fetch(API_BASE + url, {
            headers: {
                'Content-Type': 'application/json'
            },
            ...options
        });
        const data = await response.json();
        return data;
    } catch (err) {
        console.error('API请求失败:', err);
        return { success: false, error: err.message };
    }
}

function setupBackendEvents() {
    document.getElementById('saveTopoBtn').addEventListener('click', saveTopology);
    document.getElementById('refreshVersionsBtn').addEventListener('click', loadTopologyVersions);
    document.getElementById('topoVersionSelect').addEventListener('change', onVersionSelectChange);
    document.getElementById('loadVersionBtn').addEventListener('click', loadSelectedVersion);

    document.querySelectorAll('.report-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const tabName = e.target.dataset.tab;
            switchReportTab(tabName);
        });
    });

    document.getElementById('refreshHistoryBtn').addEventListener('click', loadHistoryReports);
    document.getElementById('doCompareBtn').addEventListener('click', doCompareReports);
}

function switchReportTab(tabName) {
    document.querySelectorAll('.report-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    document.querySelectorAll('.report-tab-content').forEach(content => {
        content.style.display = 'none';
    });

    document.getElementById('tab-' + tabName).style.display = 'block';

    if (tabName === 'history') {
        loadHistoryReports();
    } else if (tabName === 'compare') {
        loadCompareReportOptions();
    }
}

async function saveTopology() {
    const name = document.getElementById('topoVersionName').value.trim() || null;

    const result = await apiRequest('/topology', {
        method: 'POST',
        body: JSON.stringify({
            devices: devices.map(d => ({ id: d.id, type: d.type, name: d.name, x: d.x, y: d.y })),
            links: links.map(l => ({ id: l.id, from: l.from, to: l.to, bandwidth: l.bandwidth, delay: l.delay, enabled: l.enabled, reservationRatio: l.reservationRatio || 0 })),
            manualRoutes: manualRoutes,
            name: name
        })
    });

    if (result.success) {
        addLog(`拓扑已保存，版本号: ${result.data.version}`, 'success');
        document.getElementById('topoVersionName').value = '';
        loadTopologyVersions();
    } else {
        alert('保存失败: ' + (result.error || '未知错误'));
    }
}

async function loadTopologyVersions() {
    const result = await apiRequest('/topology/versions');
    if (result.success) {
        topologyVersions = result.data;
        renderVersionSelect();
    }
}

function renderVersionSelect() {
    const select = document.getElementById('topoVersionSelect');
    select.innerHTML = '<option value="">选择版本加载</option>';

    topologyVersions.forEach(v => {
        const option = document.createElement('option');
        option.value = v.id;
        const date = new Date(v.createdAt).toLocaleString();
        option.textContent = `v${v.version} - ${v.name} (${date})`;
        select.appendChild(option);
    });

    document.getElementById('versionInfo').style.display = 'none';
}

function onVersionSelectChange() {
    const versionId = parseInt(document.getElementById('topoVersionSelect').value);
    const versionInfo = document.getElementById('versionInfo');

    if (!versionId) {
        versionInfo.style.display = 'none';
        return;
    }

    const version = topologyVersions.find(v => v.id === versionId);
    if (version) {
        const date = new Date(version.createdAt).toLocaleString();
        document.getElementById('versionMeta').innerHTML = `
            <div style="font-size:12px;color:#666;margin-bottom:6px;">
                版本号: v${version.version}<br>
                创建时间: ${date}
            </div>
        `;
        versionInfo.style.display = 'block';
    }
}

async function loadSelectedVersion() {
    const versionId = parseInt(document.getElementById('topoVersionSelect').value);
    if (!versionId) return;

    if (!confirm('加载此版本将覆盖当前拓扑，确定继续？')) return;

    const result = await apiRequest('/topology/' + versionId);
    if (result.success) {
        applyTopologyData(result.data);
        addLog(`已加载拓扑版本 v${result.data.version}`, 'success');
    } else {
        alert('加载失败: ' + (result.error || '未知错误'));
    }
}

function applyTopologyData(data) {
    devices = data.devices.map(d => ({ ...d }));
    links = data.links.map(l => ({ ...l, enabled: l.enabled !== undefined ? l.enabled : true, reservationRatio: l.reservationRatio || 0 }));
    manualRoutes = data.manualRoutes || [];

    deviceIdCounter = Math.max(...devices.map(d => d.id), 0) + 1;
    linkIdCounter = Math.max(...links.map(l => l.id), 0) + 1;

    trafficFlows = [];
    packets = [];
    congestionStates.clear();

    faultStats = {
        disabledLinkCount: links.filter(l => !l.enabled).length,
        totalFaultCount: 0,
        pathSwitchCount: 0,
        pausedFlowCount: 0
    };

    selectedDevice = null;
    selectedLink = null;

    updateDeviceCount();
    updateDeviceSelects();
    updatePropertyPanel();
    recalculateRoutes();
    updateTrafficList();
    updateFaultStats();
    triggerPartitionRecalculation(null, 'load_topology');
}

async function saveReportToBackend(reportData) {
    const topologySnapshot = {
        devices: devices.map(d => ({ id: d.id, type: d.type, name: d.name, x: d.x, y: d.y })),
        links: links.map(l => ({ id: l.id, from: l.from, to: l.to, bandwidth: l.bandwidth, delay: l.delay, enabled: l.enabled, reservationRatio: l.reservationRatio || 0 })),
        manualRoutes: manualRoutes
    };

    const fullReport = {
        ...reportData,
        topologySnapshot
    };

    const result = await apiRequest('/reports', {
        method: 'POST',
        body: JSON.stringify(fullReport)
    });

    if (result.success) {
        addLog(`报告已保存到后端，ID: ${result.data.id}`, 'success');
        return result.data;
    } else {
        const errorMsg = result.error || '网络连接失败';
        addLog('保存报告到后端失败: ' + errorMsg, 'error');
        alert('警告：报告保存到后端失败！\n错误信息：' + errorMsg + '\n报告已在本地生成，但未持久化到服务器，刷新页面后将丢失。');
        return null;
    }
}

async function savePartitionChangeToBackend(event) {
    const topologySnapshot = {
        devices: devices.map(d => ({ id: d.id, type: d.type, name: d.name, x: d.x, y: d.y })),
        links: links.map(l => ({ id: l.id, from: l.from, to: l.to, bandwidth: l.bandwidth, delay: l.delay, enabled: l.enabled, reservationRatio: l.reservationRatio || 0 })),
        manualRoutes: manualRoutes
    };

    const fullEvent = {
        ...event,
        topologySnapshot
    };

    const result = await apiRequest('/partitions/changes', {
        method: 'POST',
        body: JSON.stringify(fullEvent)
    });

    if (!result.success) {
        console.warn('保存分区变更到后端失败:', result.error);
    }
}

async function loadPartitionHistory() {
    const result = await apiRequest('/partitions/changes?limit=10');
    if (result.success && result.data) {
        partitionChangeHistory = result.data.slice(0, MAX_PARTITION_HISTORY);
        updatePartitionPanel();
    }
}

async function loadHistoryReports() {
    const result = await apiRequest('/reports');
    if (result.success) {
        historyReports = result.data;
        renderHistoryList();
    } else {
        document.getElementById('historyList').innerHTML = 
            '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:15px;">加载失败</p>';
    }
}

function renderHistoryList() {
    const list = document.getElementById('historyList');

    if (historyReports.length === 0) {
        list.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:15px;">暂无历史报告</p>';
        return;
    }

    let html = '';
    historyReports.forEach(report => {
        const date = new Date(report.timestamp).toLocaleString();
        const statusClass = report.aborted ? 'aborted' : 'completed';
        const statusText = report.aborted ? '已中止' : '已完成';

        html += `
            <div class="history-item" onclick="viewHistoryReport(${report.id})">
                <div class="history-item-header">
                    <span class="history-item-name">${escapeHtml(report.scenarioName)}</span>
                    <span class="history-item-status status-${statusClass}">${statusText}</span>
                </div>
                <div class="history-item-meta">
                    <span>${date}</span>
                    <span>时长: ${report.totalDuration.toFixed(1)}s</span>
                    <span>流量: ${report.totalFlows}条</span>
                </div>
            </div>
        `;
    });

    list.innerHTML = html;
}

window.viewHistoryReport = async function(reportId) {
    const result = await apiRequest('/reports/' + reportId);
    if (result.success) {
        currentViewedReport = result.data;
        displayHistoryReport(result.data);
    }
};

function displayHistoryReport(report) {
    switchReportTab('current');

    scenarioReportData = report;
    renderReport();

    document.getElementById('reportScenarioName').textContent = 
        report.scenarioName + (report.aborted ? ' (历史-已中止)' : ' (历史)');
}

async function loadCompareReportOptions() {
    await loadHistoryReports();

    const select1 = document.getElementById('compareReport1');
    const select2 = document.getElementById('compareReport2');

    select1.innerHTML = '<option value="">选择报告 A</option>';
    select2.innerHTML = '<option value="">选择报告 B</option>';

    historyReports.forEach(report => {
        const date = new Date(report.timestamp).toLocaleString();
        const label = `${report.scenarioName} - ${date}`;

        const opt1 = document.createElement('option');
        opt1.value = report.id;
        opt1.textContent = label;
        select1.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = report.id;
        opt2.textContent = label;
        select2.appendChild(opt2);
    });

    document.getElementById('compareResults').style.display = 'none';
    document.getElementById('compareEmpty').style.display = 'block';
}

async function doCompareReports() {
    const id1 = parseInt(document.getElementById('compareReport1').value);
    const id2 = parseInt(document.getElementById('compareReport2').value);

    if (!id1 || !id2) {
        alert('请选择两份报告');
        return;
    }

    if (id1 === id2) {
        alert('请选择不同的报告进行对比');
        return;
    }

    const result = await apiRequest(`/reports/compare/${id1}/${id2}`);
    if (result.success) {
        compareResult = result.data;
        renderCompareResults();
    } else {
        alert('对比失败: ' + (result.error || '未知错误'));
    }
}

function renderCompareResults() {
    if (!compareResult) return;

    document.getElementById('compareEmpty').style.display = 'none';
    document.getElementById('compareResults').style.display = 'block';

    const overview = document.getElementById('compareOverviewStats');
    const { report1, report2, overview: overviewDiff } = compareResult;

    overview.innerHTML = `
        <div class="report-stat-row">
            <span class="report-stat-label">报告A</span>
            <span class="report-stat-value">${escapeHtml(report1.scenarioName)}</span>
        </div>
        <div class="report-stat-row">
            <span class="report-stat-label">报告B</span>
            <span class="report-stat-value">${escapeHtml(report2.scenarioName)}</span>
        </div>
        <div class="report-stat-row">
            <span class="report-stat-label">时长差</span>
            <span class="report-stat-value">${overviewDiff.durationDiff > 0 ? '+' : ''}${overviewDiff.durationDiff.toFixed(1)}s</span>
        </div>
        <div class="report-stat-row">
            <span class="report-stat-label">丢包率差</span>
            <span class="report-stat-value" style="color: ${overviewDiff.lossRateDiff > 0 ? '#ff4d4f' : (overviewDiff.lossRateDiff < 0 ? '#52c41a' : '#333')};">
                ${overviewDiff.lossRateDiff > 0 ? '+' : ''}${overviewDiff.lossRateDiff.toFixed(2)}%
            </span>
        </div>
    `;

    const linksTable = document.getElementById('compareLinksTable');
    let html = '<div class="compare-table-header">';
    html += '<span>链路名称</span>';
    html += '<span>峰值负载 (A→B)</span>';
    html += '<span>丢包率差</span>';
    html += '</div>';

    compareResult.links.forEach(link => {
        const peakA = (link.report1.peakLoad * 100).toFixed(1);
        const peakB = (link.report2.peakLoad * 100).toFixed(1);
        const peakDiff = link.peakLoadDiff * 100;
        const peakDiffPercent = link.peakLoadDiffPercent.toFixed(1);

        const peakColor = peakDiff > 0 ? '#ff4d4f' : (peakDiff < 0 ? '#52c41a' : '#333');
        const lossColor = link.lossRateDiff > 0 ? '#ff4d4f' : (link.lossRateDiff < 0 ? '#52c41a' : '#333');

        html += `<div class="compare-table-row">
            <span class="compare-link-name">${escapeHtml(link.linkName)}</span>
            <span style="color: ${peakColor};">
                ${peakA}% → ${peakB}%
                <span style="font-size:10px;">(${peakDiff > 0 ? '+' : ''}${peakDiffPercent}%)</span>
            </span>
            <span style="color: ${lossColor};">
                ${link.lossRateDiff > 0 ? '+' : ''}${link.lossRateDiff.toFixed(2)}%
            </span>
        </div>`;
    });

    linksTable.innerHTML = html;
}

const originalGenerateReport = generateReport;
generateReport = function(aborted = false) {
    originalGenerateReport(aborted);
    if (scenarioReportData) {
        saveReportToBackend(scenarioReportData);
    }
};

let parsedDeviceConfigs = new Map();
let currentAuditReport = null;
let auditHistory = [];
let highlightedElements = { devices: [], links: [] };
let highlightTimer = null;

const AUDIT_RULES = {
    SINGLE_POINT_OF_FAILURE: 'single_point_of_failure',
    ASYMMETRIC_BANDWIDTH: 'asymmetric_bandwidth',
    LOOP_RISK: 'loop_risk',
    IP_CONFLICT: 'ip_conflict',
    DOWN_INTERFACE: 'down_interface'
};

function setupConfigAuditEvents() {
    document.getElementById('parseConfigBtn').addEventListener('click', parseAndGenerateTopology);
    document.getElementById('loadConfigFileBtn').addEventListener('click', () => {
        document.getElementById('configFileInput').click();
    });
    document.getElementById('configFileInput').addEventListener('change', loadConfigFile);

    document.getElementById('runAuditBtn').addEventListener('click', runAudit);
    document.getElementById('exportAuditBtn').addEventListener('click', exportAuditReport);

    document.querySelectorAll('.audit-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            const tabName = e.target.dataset.auditTab;
            switchAuditTab(tabName);
        });
    });

    document.getElementById('doAuditCompareBtn')?.addEventListener('click', doAuditCompare);
}

function loadConfigFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(event) {
        document.getElementById('configInput').value = event.target.result;
    };
    reader.readAsText(file);
    e.target.value = '';
}

function parseAndGenerateTopology() {
    const configText = document.getElementById('configInput').value.trim();
    const resultEl = document.getElementById('configParseResult');

    if (!configText) {
        showParseResult('请输入设备配置JSON', 'error');
        return;
    }

    try {
        const configData = JSON.parse(configText);

        if (!Array.isArray(configData)) {
            throw new Error('配置必须是设备对象数组');
        }

        const validation = validateDeviceConfig(configData);
        if (!validation.valid) {
            throw new Error(validation.errors.join('\n'));
        }

        const layoutMode = document.getElementById('layoutMode').value;
        const result = generateTopologyFromConfig(configData, layoutMode);

        saveConfigToBackend(configData, result.devices, result.links);

        showParseResult(`成功解析 ${result.devices.length} 台设备，${result.links.length} 条链路`, 'success');

        setTimeout(() => {
            runAudit();
        }, 500);

    } catch (err) {
        showParseResult('解析失败: ' + err.message, 'error');
    }
}

function validateDeviceConfig(configData) {
    const errors = [];
    const deviceNames = new Set();

    configData.forEach((device, index) => {
        if (!device.name) {
            errors.push(`设备 #${index}: 缺少 name 字段`);
        } else if (deviceNames.has(device.name)) {
            errors.push(`设备 #${index}: 重复的设备名 ${device.name}`);
        } else {
            deviceNames.add(device.name);
        }

        if (!device.type || !['router', 'switch', 'host'].includes(device.type)) {
            errors.push(`设备 ${device.name || '#' + index}: 无效的 type 字段，必须是 router/switch/host`);
        }

        if (!device.interfaces || !Array.isArray(device.interfaces)) {
            errors.push(`设备 ${device.name || '#' + index}: 缺少 interfaces 数组`);
        } else {
            device.interfaces.forEach((iface, ifIndex) => {
                if (!iface.name) {
                    errors.push(`设备 ${device.name} 接口 #${ifIndex}: 缺少 name 字段`);
                }
                if (!iface.ip) {
                    errors.push(`设备 ${device.name} 接口 ${iface.name || '#' + ifIndex}: 缺少 ip 字段`);
                }
                if (!iface.mask) {
                    errors.push(`设备 ${device.name} 接口 ${iface.name || '#' + ifIndex}: 缺少 mask 字段`);
                }
                if (iface.bandwidth === undefined) {
                    errors.push(`设备 ${device.name} 接口 ${iface.name || '#' + ifIndex}: 缺少 bandwidth 字段`);
                }
                if (!iface.status || !['up', 'down'].includes(iface.status)) {
                    errors.push(`设备 ${device.name} 接口 ${iface.name || '#' + ifIndex}: 无效的 status 字段，必须是 up/down`);
                }
            });
        }
    });

    return { valid: errors.length === 0, errors };
}

function ipToNumber(ip) {
    return ip.split('.').reduce((acc, octet, index) => {
        return acc + (parseInt(octet) << (24 - index * 8));
    }, 0);
}

function getNetworkAddress(ip, mask) {
    const ipNum = ipToNumber(ip);
    const maskNum = ipToNumber(mask);
    const networkNum = ipNum & maskNum;
    return [
        (networkNum >>> 24) & 255,
        (networkNum >>> 16) & 255,
        (networkNum >>> 8) & 255,
        networkNum & 255
    ].join('.');
}

function isSameSubnet(ip1, mask1, ip2, mask2) {
    return getNetworkAddress(ip1, mask1) === getNetworkAddress(ip2, mask2);
}

function generateTopologyFromConfig(configData, layoutMode) {
    const nameToDevice = new Map();
    const newDevices = [];
    const newLinks = [];
    const interfaceMap = new Map();

    let nextDeviceId = Math.max(...devices.map(d => d.id), 0) + 1;
    let nextLinkId = Math.max(...links.map(l => l.id), 0) + 1;

    configData.forEach(deviceConfig => {
        const device = {
            id: nextDeviceId++,
            type: deviceConfig.type,
            name: deviceConfig.name,
            x: 0,
            y: 0
        };
        newDevices.push(device);
        nameToDevice.set(deviceConfig.name, device);

        parsedDeviceConfigs.set(device.id, {
            name: deviceConfig.name,
            type: deviceConfig.type,
            interfaces: deviceConfig.interfaces
        });

        deviceConfig.interfaces.forEach(iface => {
            const key = `${deviceConfig.name}:${iface.name}`;
            interfaceMap.set(key, {
                deviceId: device.id,
                deviceName: deviceConfig.name,
                interfaceName: iface.name,
                ip: iface.ip,
                mask: iface.mask,
                bandwidth: iface.bandwidth,
                status: iface.status,
                peerDevice: iface.peerDevice
            });
        });
    });

    const linkCreated = new Set();

    newDevices.forEach(device => {
        const deviceConfig = parsedDeviceConfigs.get(device.id);
        if (!deviceConfig) return;

        deviceConfig.interfaces.forEach(iface => {
            if (iface.peerDevice) {
                const peerDevice = nameToDevice.get(iface.peerDevice);
                if (peerDevice) {
                    const linkKey = [device.id, peerDevice.id].sort().join('-');
                    if (!linkCreated.has(linkKey)) {
                        linkCreated.add(linkKey);

                        const peerConfig = parsedDeviceConfigs.get(peerDevice.id);
                        let peerIface = peerConfig?.interfaces.find(pi => pi.peerDevice === deviceConfig.name);
                        if (!peerIface && peerConfig && iface.ip && iface.mask) {
                            const candidates = peerConfig.interfaces.filter(pi => pi.ip && pi.mask && isSameSubnet(iface.ip, iface.mask, pi.ip, pi.mask));
                            if (candidates.length === 1) {
                                peerIface = candidates[0];
                            } else if (candidates.length > 1) {
                                peerIface = candidates.find(pi => !pi.peerDevice) || candidates[0];
                            }
                        }
                        const peerBandwidth = peerIface?.bandwidth ?? iface.bandwidth;
                        const bandwidth = Math.min(iface.bandwidth, peerBandwidth);

                        const link = {
                            id: nextLinkId++,
                            from: device.id,
                            to: peerDevice.id,
                            bandwidth: bandwidth,
                            delay: 10,
                            enabled: iface.status === 'up' && (peerIface ? peerIface.status === 'up' : true),
                            interfaceInfo: {
                                [device.id]: { name: iface.name, ip: iface.ip, mask: iface.mask, bandwidth: iface.bandwidth, status: iface.status },
                                [peerDevice.id]: { 
                                    name: peerIface?.name || 'unknown', 
                                    ip: peerIface?.ip, 
                                    mask: peerIface?.mask, 
                                    bandwidth: peerBandwidth, 
                                    status: peerIface?.status || 'unknown' 
                                }
                            }
                        };
                        newLinks.push(link);
                    }
                }
            }
        });
    });

    const interfaces = Array.from(interfaceMap.values()).filter(iface => !iface.peerDevice);
    for (let i = 0; i < interfaces.length; i++) {
        for (let j = i + 1; j < interfaces.length; j++) {
            const if1 = interfaces[i];
            const if2 = interfaces[j];

            if (if1.deviceId === if2.deviceId) continue;

            const linkKey = [if1.deviceId, if2.deviceId].sort().join('-');
            if (linkCreated.has(linkKey)) continue;

            if (isSameSubnet(if1.ip, if1.mask, if2.ip, if2.mask)) {
                linkCreated.add(linkKey);

                const bandwidth = Math.min(if1.bandwidth, if2.bandwidth);
                const link = {
                    id: nextLinkId++,
                    from: if1.deviceId,
                    to: if2.deviceId,
                    bandwidth: bandwidth,
                    delay: 10,
                    enabled: if1.status === 'up' && if2.status === 'up',
                    interfaceInfo: {
                        [if1.deviceId]: { name: if1.interfaceName, ip: if1.ip, mask: if1.mask, bandwidth: if1.bandwidth, status: if1.status },
                        [if2.deviceId]: { name: if2.interfaceName, ip: if2.ip, mask: if2.mask, bandwidth: if2.bandwidth, status: if2.status }
                    }
                };
                newLinks.push(link);
            }
        }
    }

    applyLayout(newDevices, newLinks, layoutMode);

    devices.length = 0;
    links.length = 0;
    devices.push(...newDevices);
    links.push(...newLinks);

    deviceIdCounter = nextDeviceId;
    linkIdCounter = nextLinkId;

    updateDeviceCount();
    updateDeviceSelects();
    recalculateRoutes();
    updateFaultStats();
    triggerPartitionRecalculation(null, 'config_generated');

    return { devices: newDevices, links: newLinks };
}

function applyLayout(newDevices, newLinks, layoutMode) {
    const canvasWidth = canvas.width / scale;
    const canvasHeight = canvas.height / scale;
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    if (layoutMode === 'ring') {
        applyRingLayout(newDevices, centerX, centerY);
    } else if (layoutMode === 'grid') {
        applyGridLayout(newDevices, centerX, centerY);
    } else {
        applyForceLayout(newDevices, newLinks, centerX, centerY);
    }
}

function applyRingLayout(devices, centerX, centerY) {
    const radius = Math.min(centerX, centerY) * 0.7;
    const angleStep = (2 * Math.PI) / devices.length;

    devices.forEach((device, index) => {
        const angle = index * angleStep - Math.PI / 2;
        device.x = centerX + radius * Math.cos(angle);
        device.y = centerY + radius * Math.sin(angle);
    });
}

function applyGridLayout(devices, centerX, centerY) {
    const cols = Math.ceil(Math.sqrt(devices.length));
    const rows = Math.ceil(devices.length / cols);
    const spacing = Math.min(centerX, centerY) * 0.8 / Math.max(cols, rows);
    const startX = centerX - ((cols - 1) * spacing) / 2;
    const startY = centerY - ((rows - 1) * spacing) / 2;

    devices.forEach((device, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        device.x = startX + col * spacing;
        device.y = startY + row * spacing;
    });
}

function applyForceLayout(devices, links, centerX, centerY) {
    applyRingLayout(devices, centerX, centerY);

    const iterations = 100;
    const k = Math.sqrt((canvas.width * canvas.height) / (scale * scale * devices.length)) * 0.5;

    for (let iter = 0; iter < iterations; iter++) {
        const forces = devices.map(() => ({ x: 0, y: 0 }));

        for (let i = 0; i < devices.length; i++) {
            for (let j = i + 1; j < devices.length; j++) {
                const dx = devices[i].x - devices[j].x;
                const dy = devices[i].y - devices[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
                const repulsion = (k * k) / dist;

                forces[i].x += (dx / dist) * repulsion;
                forces[i].y += (dy / dist) * repulsion;
                forces[j].x -= (dx / dist) * repulsion;
                forces[j].y -= (dy / dist) * repulsion;
            }
        }

        links.forEach(link => {
            const fromIdx = devices.findIndex(d => d.id === link.from);
            const toIdx = devices.findIndex(d => d.id === link.to);
            if (fromIdx === -1 || toIdx === -1) return;

            const dx = devices[toIdx].x - devices[fromIdx].x;
            const dy = devices[toIdx].y - devices[fromIdx].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
            const attraction = (dist * dist) / k;

            forces[fromIdx].x += (dx / dist) * attraction;
            forces[fromIdx].y += (dy / dist) * attraction;
            forces[toIdx].x -= (dx / dist) * attraction;
            forces[toIdx].y -= (dy / dist) * attraction;
        });

        devices.forEach((device, i) => {
            const cx = centerX - device.x;
            const cy = centerY - device.y;
            forces[i].x += cx * 0.01;
            forces[i].y += cy * 0.01;
        });

        const temperature = 1 - iter / iterations;
        devices.forEach((device, i) => {
            const fx = forces[i].x;
            const fy = forces[i].y;
            const forceMag = Math.sqrt(fx * fx + fy * fy) || 0.1;
            const maxMove = temperature * 50;

            device.x += (fx / forceMag) * Math.min(forceMag, maxMove);
            device.y += (fy / forceMag) * Math.min(forceMag, maxMove);

            const margin = 50;
            device.x = Math.max(margin, Math.min(canvas.width / scale - margin, device.x));
            device.y = Math.max(margin, Math.min(canvas.height / scale - margin, device.y));
        });
    }
}

async function saveConfigToBackend(configData, parsedDevices, parsedLinks) {
    const result = await apiRequest('/configs', {
        method: 'POST',
        body: JSON.stringify({
            configData,
            parsedDevices: parsedDevices.map(d => ({ id: d.id, type: d.type, name: d.name, x: d.x, y: d.y })),
            parsedLinks: parsedLinks.map(l => ({ id: l.id, from: l.from, to: l.to, bandwidth: l.bandwidth, delay: l.delay, enabled: l.enabled, reservationRatio: l.reservationRatio || 0 }))
        })
    });

    if (result.success) {
        addLog(`配置已保存到后端，ID: ${result.data.id}`, 'success');
    } else {
        addLog('保存配置到后端失败: ' + (result.error || '未知错误'), 'error');
    }
}

function showParseResult(message, type) {
    const resultEl = document.getElementById('configParseResult');
    resultEl.textContent = message;
    resultEl.className = `parse-result ${type}`;
    resultEl.style.display = 'block';

    if (type === 'success') {
        setTimeout(() => {
            resultEl.style.display = 'none';
        }, 5000);
    }
}

function runAudit() {
    if (devices.length === 0) {
        showAuditEmpty();
        return;
    }

    const alerts = [];

    alerts.push(...checkSinglePointOfFailure());
    alerts.push(...checkAsymmetricBandwidth());
    alerts.push(...checkLoopRisk());
    alerts.push(...checkIpConflict());
    alerts.push(...checkDownInterface());

    const auditReport = {
        timestamp: Date.now(),
        totalAlerts: alerts.length,
        criticalCount: alerts.filter(a => a.level === 'critical').length,
        warningCount: alerts.filter(a => a.level === 'warning').length,
        infoCount: alerts.filter(a => a.level === 'info').length,
        alerts: alerts,
        topologySnapshot: {
            devices: devices.map(d => ({ id: d.id, type: d.type, name: d.name, x: d.x, y: d.y })),
            links: links.map(l => ({ id: l.id, from: l.from, to: l.to, bandwidth: l.bandwidth, delay: l.delay, enabled: l.enabled, reservationRatio: l.reservationRatio || 0 }))
        }
    };

    currentAuditReport = auditReport;

    saveAuditToBackend(auditReport);

    renderAuditReport(auditReport);

    if (alerts.length > 0) {
        addLog(`审计完成，发现 ${alerts.length} 个问题 (严重:${auditReport.criticalCount}, 警告:${auditReport.warningCount}, 提示:${auditReport.infoCount})`, 
            auditReport.criticalCount > 0 ? 'error' : (auditReport.warningCount > 0 ? 'warning' : 'info'));
    } else {
        addLog('审计完成，未发现配置问题', 'success');
    }
}

function checkSinglePointOfFailure() {
    const alerts = [];
    const deviceLinkCount = new Map();

    links.forEach(link => {
        if (!link.enabled) return;
        deviceLinkCount.set(link.from, (deviceLinkCount.get(link.from) || 0) + 1);
        deviceLinkCount.set(link.to, (deviceLinkCount.get(link.to) || 0) + 1);
    });

    devices.forEach(device => {
        const count = deviceLinkCount.get(device.id) || 0;
        if (count === 1) {
            alerts.push({
                id: `${AUDIT_RULES.SINGLE_POINT_OF_FAILURE}-${device.id}`,
                rule: AUDIT_RULES.SINGLE_POINT_OF_FAILURE,
                level: 'warning',
                deviceIds: [device.id],
                linkIds: [],
                title: '单点故障风险',
                description: `设备 ${device.name} 只有 ${count} 条有效链路连接到网络，一旦该链路中断，设备将被孤立。`,
                timestamp: Date.now()
            });
        } else if (count === 0 && devices.length > 1) {
            alerts.push({
                id: `${AUDIT_RULES.SINGLE_POINT_OF_FAILURE}-${device.id}-isolated`,
                rule: AUDIT_RULES.SINGLE_POINT_OF_FAILURE,
                level: 'critical',
                deviceIds: [device.id],
                linkIds: [],
                title: '设备已孤立',
                description: `设备 ${device.name} 没有任何有效链路连接，已完全孤立于网络之外。`,
                timestamp: Date.now()
            });
        }
    });

    return alerts;
}

function checkAsymmetricBandwidth() {
    const alerts = [];

    links.forEach(link => {
        if (!link.interfaceInfo) return;

        const fromInfo = link.interfaceInfo[link.from];
        const toInfo = link.interfaceInfo[link.to];

        if (!fromInfo || !toInfo) return;

        if (fromInfo.bandwidth !== toInfo.bandwidth) {
            const fromDevice = devices.find(d => d.id === link.from);
            const toDevice = devices.find(d => d.id === link.to);

            alerts.push({
                id: `${AUDIT_RULES.ASYMMETRIC_BANDWIDTH}-${link.id}`,
                rule: AUDIT_RULES.ASYMMETRIC_BANDWIDTH,
                level: 'warning',
                deviceIds: [link.from, link.to],
                linkIds: [link.id],
                title: '非对称带宽配置',
                description: `链路 ${fromDevice?.name || link.from} ↔ ${toDevice?.name || link.to} 两端带宽配置不一致：${fromInfo.bandwidth ?? '未知'}Mbps vs ${toInfo.bandwidth ?? '未知'}Mbps。这可能导致流量不均衡。`,
                timestamp: Date.now()
            });
        }
    });

    return alerts;
}

function checkLoopRisk() {
    const alerts = [];

    function findCycles() {
        const adjList = new Map();
        devices.forEach(d => adjList.set(d.id, []));
        links.forEach(link => {
            if (!link.enabled) return;
            adjList.get(link.from)?.push({ node: link.to, linkId: link.id });
            adjList.get(link.to)?.push({ node: link.from, linkId: link.id });
        });

        const cycles = [];
        const visited = new Set();
        const path = [];
        const pathSet = new Set();

        function dfs(node, parent) {
            visited.add(node);
            path.push(node);
            pathSet.add(node);

            const neighbors = adjList.get(node) || [];
            for (const { node: neighbor, linkId } of neighbors) {
                if (neighbor === parent) continue;

                if (pathSet.has(neighbor)) {
                    const cycleStartIdx = path.indexOf(neighbor);
                    if (cycleStartIdx !== -1) {
                        const cycleNodes = path.slice(cycleStartIdx);
                        if (cycleNodes.length >= 3) {
                            const cycleLinkIds = [];
                            for (let i = 0; i < cycleNodes.length; i++) {
                                const curr = cycleNodes[i];
                                const next = cycleNodes[(i + 1) % cycleNodes.length];
                                const edge = adjList.get(curr)?.find(e => e.node === next);
                                if (edge) cycleLinkIds.push(edge.linkId);
                            }
                            cycles.push({ nodes: cycleNodes, links: cycleLinkIds });
                        }
                    }
                } else if (!visited.has(neighbor)) {
                    dfs(neighbor, node);
                }
            }

            path.pop();
            pathSet.delete(node);
        }

        devices.forEach(d => {
            if (!visited.has(d.id)) {
                dfs(d.id, null);
            }
        });

        const uniqueCycles = [];
        const seen = new Set();
        cycles.forEach(cycle => {
            const key = [...cycle.nodes].sort().join(',');
            if (!seen.has(key)) {
                seen.add(key);
                uniqueCycles.push(cycle);
            }
        });

        return uniqueCycles;
    }

    const cycles = findCycles();

    cycles.forEach(cycle => {
        const hasBackupLink = cycle.links.some(linkId => {
            const link = links.find(l => l.id === linkId);
            return link && !link.enabled;
        });

        if (!hasBackupLink) {
            const nodeNames = cycle.nodes.map(id => {
                const d = devices.find(dev => dev.id === id);
                return d?.name || id;
            });

            alerts.push({
                id: `${AUDIT_RULES.LOOP_RISK}-${cycle.nodes.join('-')}`,
                rule: AUDIT_RULES.LOOP_RISK,
                level: 'critical',
                deviceIds: cycle.nodes,
                linkIds: cycle.links,
                title: '环路风险',
                description: `检测到由 ${cycle.nodes.length} 个节点构成的环路：${nodeNames.join(' → ')}。该环路中没有任何链路被标记为备份，可能导致广播风暴。`,
                timestamp: Date.now()
            });
        }
    });

    return alerts;
}

function checkIpConflict() {
    const alerts = [];
    const ipMap = new Map();

    parsedDeviceConfigs.forEach((config, deviceId) => {
        config.interfaces.forEach(iface => {
            if (!iface.ip) return;

            if (!ipMap.has(iface.ip)) {
                ipMap.set(iface.ip, []);
            }
            ipMap.get(iface.ip).push({
                deviceId,
                deviceName: config.name,
                interfaceName: iface.name
            });
        });
    });

    ipMap.forEach((entries, ip) => {
        if (entries.length > 1) {
            const conflictDevices = entries.map(e => `${e.deviceName}(${e.interfaceName})`);
            const deviceIds = entries.map(e => e.deviceId);

            alerts.push({
                id: `${AUDIT_RULES.IP_CONFLICT}-${ip}`,
                rule: AUDIT_RULES.IP_CONFLICT,
                level: 'critical',
                deviceIds: deviceIds,
                linkIds: [],
                title: 'IP地址冲突',
                description: `IP地址 ${ip} 被 ${entries.length} 个接口同时使用：${conflictDevices.join('、')}。这将导致严重的网络通信问题。`,
                timestamp: Date.now()
            });
        }
    });

    return alerts;
}

function checkDownInterface() {
    const alerts = [];

    links.forEach(link => {
        if (!link.interfaceInfo) return;

        const fromInfo = link.interfaceInfo[link.from];
        const toInfo = link.interfaceInfo[link.to];

        if (!fromInfo || !toInfo) return;

        const fromDevice = devices.find(d => d.id === link.from);
        const toDevice = devices.find(d => d.id === link.to);

        if (fromInfo.status === 'down' && toInfo.status === 'up') {
            alerts.push({
                id: `${AUDIT_RULES.DOWN_INTERFACE}-${link.id}-from`,
                rule: AUDIT_RULES.DOWN_INTERFACE,
                level: 'warning',
                deviceIds: [link.from, link.to],
                linkIds: [link.id],
                title: '接口状态异常',
                description: `链路 ${fromDevice?.name || link.from}(${fromInfo.name}) 状态为 down，但对端 ${toDevice?.name || link.to}(${toInfo.name}) 状态为 up。可能存在一侧配置异常或物理链路问题。`,
                timestamp: Date.now()
            });
        } else if (fromInfo.status === 'up' && toInfo.status === 'down') {
            alerts.push({
                id: `${AUDIT_RULES.DOWN_INTERFACE}-${link.id}-to`,
                rule: AUDIT_RULES.DOWN_INTERFACE,
                level: 'warning',
                deviceIds: [link.from, link.to],
                linkIds: [link.id],
                title: '接口状态异常',
                description: `链路 ${fromDevice?.name || link.from}(${fromInfo.name}) 状态为 up，但对端 ${toDevice?.name || link.to}(${toInfo.name}) 状态为 down。可能存在一侧配置异常或物理链路问题。`,
                timestamp: Date.now()
            });
        }
    });

    parsedDeviceConfigs.forEach((config, deviceId) => {
        config.interfaces.forEach(iface => {
            if (iface.status === 'down' && !iface.peerDevice) {
                const hasLink = links.some(link => {
                    if (!link.interfaceInfo) return false;
                    const info = link.interfaceInfo[deviceId];
                    return info && info.name === iface.name;
                });

                if (!hasLink) {
                    alerts.push({
                        id: `${AUDIT_RULES.DOWN_INTERFACE}-${deviceId}-${iface.name}`,
                        rule: AUDIT_RULES.DOWN_INTERFACE,
                        level: 'info',
                        deviceIds: [deviceId],
                        linkIds: [],
                        title: '接口未启用',
                        description: `设备 ${config.name} 的接口 ${iface.name} 状态为 down 且未连接到任何对端设备。`,
                        timestamp: Date.now()
                    });
                }
            }
        });
    });

    return alerts;
}

async function saveAuditToBackend(auditReport) {
    const result = await apiRequest('/audits', {
        method: 'POST',
        body: JSON.stringify(auditReport)
    });

    if (result.success) {
        addLog(`审计报告已保存到后端，ID: ${result.data.id}`, 'success');
        currentAuditReport.id = result.data.id;
        return result.data;
    } else {
        addLog('保存审计报告到后端失败: ' + (result.error || '未知错误'), 'error');
        return null;
    }
}

function showAuditEmpty() {
    const alertsEl = document.getElementById('auditAlerts');
    const summaryEl = document.getElementById('auditSummary');
    const tabsEl = document.getElementById('auditTabs');

    summaryEl.style.display = 'none';
    tabsEl.style.display = 'none';
    alertsEl.innerHTML = '<div class="audit-empty">暂无拓扑数据，请先创建设备或上传配置</div>';
}

function renderAuditReport(report) {
    const summaryEl = document.getElementById('auditSummary');
    const alertsEl = document.getElementById('auditAlerts');
    const tabsEl = document.getElementById('auditTabs');

    summaryEl.style.display = 'grid';
    tabsEl.style.display = 'flex';

    summaryEl.innerHTML = `
        <div class="audit-summary-item critical">
            <div class="audit-summary-count">${report.criticalCount}</div>
            <div class="audit-summary-label">严重</div>
        </div>
        <div class="audit-summary-item warning">
            <div class="audit-summary-count">${report.warningCount}</div>
            <div class="audit-summary-label">警告</div>
        </div>
        <div class="audit-summary-item info">
            <div class="audit-summary-count">${report.infoCount}</div>
            <div class="audit-summary-label">提示</div>
        </div>
    `;

    if (report.alerts.length === 0) {
        alertsEl.innerHTML = '<div class="audit-empty">🎉 恭喜！未发现任何配置问题</div>';
        return;
    }

    const grouped = {
        critical: report.alerts.filter(a => a.level === 'critical'),
        warning: report.alerts.filter(a => a.level === 'warning'),
        info: report.alerts.filter(a => a.level === 'info')
    };

    let html = '';
    const levelNames = { critical: '严重', warning: '警告', info: '提示' };
    const levelOrder = ['critical', 'warning', 'info'];

    levelOrder.forEach(level => {
        const alerts = grouped[level];
        if (alerts.length === 0) return;

        html += `
            <div class="audit-alert-group">
                <div class="audit-alert-group-header ${level}">
                    <span>${levelNames[level]} (${alerts.length})</span>
                </div>
        `;

        alerts.forEach(alert => {
            const deviceNames = alert.deviceIds?.map(id => {
                const d = devices.find(dev => dev.id === id);
                return d?.name || id;
            }).join('、') || '-';

            html += `
                <div class="audit-alert-item ${level}" 
                     onclick="highlightAlertElements(${JSON.stringify(alert).replace(/"/g, '&quot;')})"
                     title="点击高亮显示相关设备和链路">
                    <div class="audit-alert-title">${escapeHtml(alert.title)}</div>
                    <div class="audit-alert-desc">${escapeHtml(alert.description)}</div>
                    <div class="audit-alert-desc" style="margin-top:4px;color:#888;">
                        涉及设备: ${escapeHtml(deviceNames)}
                    </div>
                    <span class="audit-alert-tag ${level}">${levelNames[level]}</span>
                </div>
            `;
        });

        html += `</div>`;
    });

    alertsEl.innerHTML = html;
}

window.highlightAlertElements = function(alert) {
    clearHighlight();

    const deviceIds = alert.deviceIds || [];
    const linkIds = alert.linkIds || [];

    deviceIds.forEach(id => {
        const device = devices.find(d => d.id === id);
        if (device) highlightedElements.devices.push(device);
    });

    linkIds.forEach(id => {
        const link = links.find(l => l.id === id);
        if (link) highlightedElements.links.push(link);
    });

    addLog(`高亮显示告警相关的 ${highlightedElements.devices.length} 个设备和 ${highlightedElements.links.length} 条链路`, 'info');

    highlightTimer = setTimeout(() => {
        clearHighlight();
    }, 3000);
};

function clearHighlight() {
    highlightedElements.devices = [];
    highlightedElements.links = [];
    if (highlightTimer) {
        clearTimeout(highlightTimer);
        highlightTimer = null;
    }
}

const originalDrawDevice = drawDevice;
drawDevice = function(device) {
    if (highlightedElements.devices.includes(device)) {
        ctx.save();
        ctx.translate(device.x, device.y);
        const flash = Math.sin(Date.now() / 100) > 0;
        ctx.beginPath();
        ctx.arc(0, 0, DEVICE_RADIUS + 10, 0, Math.PI * 2);
        ctx.strokeStyle = flash ? '#ff0000' : '#ffff00';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
    }
    originalDrawDevice(device);
};

const originalDrawLink = drawLink;
drawLink = function(link) {
    if (highlightedElements.links.includes(link)) {
        const from = devices.find(d => d.id === link.from);
        const to = devices.find(d => d.id === link.to);
        if (from && to) {
            const flash = Math.sin(Date.now() / 100) > 0;
            ctx.strokeStyle = flash ? '#ff0000' : '#ffff00';
            ctx.lineWidth = 8;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
        }
    }
    originalDrawLink(link);
};

function exportAuditReport() {
    if (!currentAuditReport) {
        alert('没有可导出的审计报告，请先运行审计');
        return;
    }

    const json = JSON.stringify(currentAuditReport, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_report_${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
    addLog('审计报告已导出', 'success');
}

function switchAuditTab(tabName) {
    document.querySelectorAll('.audit-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.auditTab === tabName);
    });

    document.querySelectorAll('.audit-tab-content').forEach(content => {
        content.style.display = 'none';
    });

    document.getElementById('audit-tab-' + tabName).style.display = 'block';

    if (tabName === 'history') {
        loadAuditHistory();
    } else if (tabName === 'compare') {
        loadAuditCompareOptions();
    }
}

async function loadAuditHistory() {
    const result = await apiRequest('/audits');
    if (result.success) {
        auditHistory = result.data;
        renderAuditHistory();
    }
}

function renderAuditHistory() {
    const container = document.getElementById('audit-tab-history');

    if (auditHistory.length === 0) {
        container.innerHTML = '<div class="audit-empty">暂无历史审计记录</div>';
        return;
    }

    let html = '<div class="audit-history-list">';

    auditHistory.forEach(audit => {
        const date = new Date(audit.timestamp).toLocaleString();
        html += `
            <div class="audit-history-item" onclick="loadAuditHistoryDetail(${audit.id})">
                <div class="audit-history-header">
                    <span style="font-weight:500;">审计报告 #${audit.id}</span>
                    <span class="audit-history-time">${date}</span>
                </div>
                <div class="audit-history-stats">
                    <span>共 ${audit.totalAlerts} 个问题</span>
                    <span class="audit-history-stat critical">严重: ${audit.criticalCount}</span>
                    <span class="audit-history-stat warning">警告: ${audit.warningCount}</span>
                    <span class="audit-history-stat info">提示: ${audit.infoCount}</span>
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

window.loadAuditHistoryDetail = async function(auditId) {
    const result = await apiRequest('/audits/' + auditId);
    if (result.success) {
        currentAuditReport = result.data;
        renderAuditReport(result.data);
        switchAuditTab('current');
        addLog(`已加载历史审计报告 #${auditId}`, 'info');
    }
};

async function loadAuditCompareOptions() {
    await loadAuditHistory();

    const container = document.getElementById('audit-tab-compare');

    if (auditHistory.length < 2) {
        container.innerHTML = '<div class="audit-empty">需要至少两份审计报告才能进行对比</div>';
        return;
    }

    let html = `
        <div class="audit-compare-selectors">
            <div class="form-group">
                <label>审计报告 A</label>
                <select id="compareAudit1">
                    <option value="">选择报告 A</option>
                    ${auditHistory.map(a => {
                        const date = new Date(a.timestamp).toLocaleString();
                        return `<option value="${a.id}">#${a.id} - ${date} (${a.totalAlerts}个问题)</option>`;
                    }).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>审计报告 B</label>
                <select id="compareAudit2">
                    <option value="">选择报告 B</option>
                    ${auditHistory.map(a => {
                        const date = new Date(a.timestamp).toLocaleString();
                        return `<option value="${a.id}">#${a.id} - ${date} (${a.totalAlerts}个问题)</option>`;
                    }).join('')}
                </select>
            </div>
            <button id="doAuditCompareBtn" class="btn btn-primary">开始对比</button>
        </div>
        <div id="auditCompareResults" style="display:none;"></div>
        <div id="auditCompareEmpty" class="audit-empty" style="display:none;">
            选择两份审计报告进行对比
        </div>
    `;

    container.innerHTML = html;

    document.getElementById('doAuditCompareBtn').addEventListener('click', doAuditCompare);
}

async function doAuditCompare() {
    const id1 = parseInt(document.getElementById('compareAudit1').value);
    const id2 = parseInt(document.getElementById('compareAudit2').value);

    if (!id1 || !id2) {
        alert('请选择两份审计报告');
        return;
    }

    if (id1 === id2) {
        alert('请选择不同的报告进行对比');
        return;
    }

    const result = await apiRequest(`/audits/compare/${id1}/${id2}`);
    if (result.success) {
        renderAuditCompareResults(result.data);
    } else {
        alert('对比失败: ' + (result.error || '未知错误'));
    }
}

function renderAuditCompareResults(compareData) {
    const resultsEl = document.getElementById('auditCompareResults');
    const emptyEl = document.getElementById('auditCompareEmpty');

    emptyEl.style.display = 'none';
    resultsEl.style.display = 'block';

    const { report1, report2, added, removed, changed } = compareData;

    const date1 = new Date(report1.timestamp).toLocaleString();
    const date2 = new Date(report2.timestamp).toLocaleString();

    let html = `
        <div class="audit-compare-results">
            <div class="audit-compare-overview">
                <h4>对比总览</h4>
                <div class="audit-compare-stats">
                    <div class="report-stat-row">
                        <span class="report-stat-label">报告 A</span>
                        <span class="report-stat-value">#${report1.id} - ${date1}</span>
                    </div>
                    <div class="report-stat-row">
                        <span class="report-stat-label">报告 B</span>
                        <span class="report-stat-value">#${report2.id} - ${date2}</span>
                    </div>
                    <div class="report-stat-row">
                        <span class="report-stat-label">问题总数变化</span>
                        <span class="report-stat-value" style="color: ${report2.totalAlerts > report1.totalAlerts ? '#ff4d4f' : (report2.totalAlerts < report1.totalAlerts ? '#52c41a' : '#333')};">
                            ${report1.totalAlerts} → ${report2.totalAlerts}
                            (${report2.totalAlerts > report1.totalAlerts ? '+' : ''}${report2.totalAlerts - report1.totalAlerts})
                        </span>
                    </div>
                    <div class="report-stat-row">
                        <span class="report-stat-label">严重问题变化</span>
                        <span class="report-stat-value" style="color: ${report2.criticalCount > report1.criticalCount ? '#ff4d4f' : (report2.criticalCount < report1.criticalCount ? '#52c41a' : '#333')};">
                            ${report1.criticalCount} → ${report2.criticalCount}
                            (${report2.criticalCount > report1.criticalCount ? '+' : ''}${report2.criticalCount - report1.criticalCount})
                        </span>
                    </div>
                </div>
            </div>
    `;

    if (added.length > 0) {
        html += `
            <div class="audit-compare-alerts-section">
                <h4>新增告警 (${added.length})</h4>
        `;
        added.forEach(alert => {
            html += `
                <div class="audit-compare-alert-item added" onclick="highlightAlertElements(${JSON.stringify(alert).replace(/"/g, '&quot;')})">
                    <span class="audit-compare-badge added">新增</span>
                    <span class="audit-alert-tag ${alert.level}">${alert.level === 'critical' ? '严重' : alert.level === 'warning' ? '警告' : '提示'}</span>
                    <strong>${escapeHtml(alert.title)}</strong><br>
                    <span style="color:#666;font-size:11px;">${escapeHtml(alert.description)}</span>
                </div>
            `;
        });
        html += `</div>`;
    }

    if (removed.length > 0) {
        html += `
            <div class="audit-compare-alerts-section">
                <h4>已修复告警 (${removed.length})</h4>
        `;
        removed.forEach(alert => {
            html += `
                <div class="audit-compare-alert-item removed">
                    <span class="audit-compare-badge removed">已修复</span>
                    <span class="audit-alert-tag ${alert.level}">${alert.level === 'critical' ? '严重' : alert.level === 'warning' ? '警告' : '提示'}</span>
                    <strong>${escapeHtml(alert.title)}</strong><br>
                    <span style="color:#666;font-size:11px;">${escapeHtml(alert.description)}</span>
                </div>
            `;
        });
        html += `</div>`;
    }

    if (changed.length > 0) {
        html += `
            <div class="audit-compare-alerts-section">
                <h4>有变化的告警 (${changed.length})</h4>
        `;
        changed.forEach(({ old: oldAlert, new: newAlert }) => {
            html += `
                <div class="audit-compare-alert-item changed" onclick="highlightAlertElements(${JSON.stringify(newAlert).replace(/"/g, '&quot;')})">
                    <span class="audit-compare-badge changed">已变更</span>
                    <span class="audit-alert-tag ${newAlert.level}">${newAlert.level === 'critical' ? '严重' : newAlert.level === 'warning' ? '警告' : '提示'}</span>
                    <strong>${escapeHtml(newAlert.title)}</strong><br>
                    <span style="color:#666;font-size:11px;">新: ${escapeHtml(newAlert.description)}</span>
                </div>
            `;
        });
        html += `</div>`;
    }

    if (added.length === 0 && removed.length === 0 && changed.length === 0) {
        html += `
            <div class="audit-empty" style="margin-top:10px;">
                两份报告内容一致，没有差异
            </div>
        `;
    }

    html += `</div>`;
    resultsEl.innerHTML = html;
}

let isRecording = false;
let recordingStartTime = 0;
let recordingSamplingTimer = null;
let recordingLinkSamples = {};
let recordingEvents = [];
let recordingPrevCongestion = new Set();
let trafficRecordings = [];
let currentCompareRecordingData = null;

let isPlayback = false;
let playbackData = null;
let playbackPaused = false;
let playbackCurrentTime = 0;
let playbackTimer = null;
let playbackLinkLoads = new Map();
let playbackCongestion = new Set();

const RECORDING_SAMPLE_INTERVAL = 200;

function setupTrafficRecordingEvents() {
    document.getElementById('startRecordingBtn').addEventListener('click', startRecording);
    document.getElementById('stopRecordingBtn').addEventListener('click', stopRecording);
    document.getElementById('refreshRecordingsBtn').addEventListener('click', loadTrafficRecordings);

    document.getElementById('playbackPauseBtn').addEventListener('click', togglePlaybackPause);
    document.getElementById('playbackExitBtn').addEventListener('click', exitPlayback);
    document.getElementById('playbackSeekBar').addEventListener('input', (e) => {
        if (!playbackData) return;
        const pct = parseFloat(e.target.value);
        const targetTime = (pct / 100) * playbackData.duration;
        seekPlayback(targetTime);
    });

    document.getElementById('doCompareRecordingsBtn').addEventListener('click', doCompareRecordings);
}

function buildLinkKey(fromId, toId) {
    return `${fromId}-${toId}`;
}

function getActiveFlowCount() {
    return trafficFlows.filter(f => !f.completed && !f.paused).length;
}

function startRecording() {
    if (isRecording || isPlayback) return;

    isRecording = true;
    recordingStartTime = Date.now();
    recordingLinkSamples = {};
    recordingEvents = [];
    recordingPrevCongestion = new Set(congestionStates.keys());

    links.forEach(link => {
        const key = buildLinkKey(link.from, link.to);
        recordingLinkSamples[key] = [];
    });

    document.getElementById('startRecordingBtn').style.display = 'none';
    document.getElementById('stopRecordingBtn').style.display = 'inline-block';
    document.getElementById('recordingStatus').style.display = 'flex';
    updateRecordingTime();

    recordingSamplingTimer = setInterval(recordingSample, RECORDING_SAMPLE_INTERVAL);
    addLog('开始录制流量', 'info');
}

function updateRecordingTime() {
    if (!isRecording) return;
    const elapsed = (Date.now() - recordingStartTime) / 1000;
    document.getElementById('recordingTime').textContent = elapsed.toFixed(1) + 's';
    requestAnimationFrame(updateRecordingTime);
}

function recordingSample() {
    if (!isRecording) return;
    const elapsed = (Date.now() - recordingStartTime) / 1000;
    const activeFlows = getActiveFlowCount();

    links.forEach(link => {
        const key = buildLinkKey(link.from, link.to);
        if (!recordingLinkSamples[key]) {
            recordingLinkSamples[key] = [];
        }
        const load = getLinkLoad(link.id);
        recordingLinkSamples[key].push({
            time: Math.round(elapsed * 10) / 10,
            load: load,
            activeFlows: activeFlows
        });
    });

    const currentCongested = new Set(congestionStates.keys());
    currentCongested.forEach(linkId => {
        if (!recordingPrevCongestion.has(linkId)) {
            recordTrafficEvent('congestion-start', elapsed, linkId);
        }
    });
    recordingPrevCongestion.forEach(linkId => {
        if (!currentCongested.has(linkId)) {
            recordTrafficEvent('congestion-end', elapsed, linkId);
        }
    });
    recordingPrevCongestion = currentCongested;
}

function recordTrafficEvent(type, time, linkId = null, flowId = null, extra = {}) {
    if (!isRecording) return;

    const event = {
        type,
        time: Math.round(time * 10) / 10,
        linkId,
        flowId,
        ...extra
    };

    if (linkId) {
        const link = links.find(l => l.id === linkId);
        if (link) {
            event.linkName = `${getDeviceName(link.from)} - ${getDeviceName(link.to)}`;
        }
    }

    if (flowId) {
        const flow = trafficFlows.find(f => f.id === flowId);
        if (flow) {
            event.flowSrc = getDeviceName(flow.srcId);
            event.flowDst = getDeviceName(flow.dstId);
        }
    }

    recordingEvents.push(event);
}

const originalInjectTraffic = injectTraffic;
injectTraffic = function(srcId, dstId, dataSizeKB, rateMbps, priority) {
    const result = originalInjectTraffic(srcId, dstId, dataSizeKB, rateMbps, priority);
    if (result && isRecording) {
        const elapsed = (Date.now() - recordingStartTime) / 1000;
        const flow = trafficFlows[trafficFlows.length - 1];
        if (flow) {
            recordTrafficEvent('inject', elapsed, null, flow.id, {
                dataSizeKB, rateMbps, priority
            });
        }
    }
    return result;
};

const originalCheckFlowCompletion = checkFlowCompletion;
checkFlowCompletion = function() {
    const before = trafficFlows.filter(f => !f.completed).map(f => f.id);
    originalCheckFlowCompletion();
    const after = trafficFlows.filter(f => !f.completed).map(f => f.id);
    const completed = before.filter(id => !after.includes(id));

    if (isRecording && completed.length > 0) {
        const elapsed = (Date.now() - recordingStartTime) / 1000;
        completed.forEach(flowId => {
            recordTrafficEvent('complete', elapsed, null, flowId);
        });
    }
};

const originalCreatePacket = createPacket;
createPacket = function(flow) {
    const beforeLost = flow.lostPackets;
    originalCreatePacket(flow);
    if (isRecording && flow.lostPackets > beforeLost) {
        const elapsed = (Date.now() - recordingStartTime) / 1000;
        if (flow.path && flow.path.segments && flow.path.segments.length > 0) {
            const linkId = flow.path.segments[0].link.id;
            recordTrafficEvent('loss', elapsed, linkId, flow.id);
        }
    }
};

function stopRecording() {
    if (!isRecording) return;

    isRecording = false;
    clearInterval(recordingSamplingTimer);
    recordingSamplingTimer = null;

    const duration = (Date.now() - recordingStartTime) / 1000;
    const sampleCount = Object.values(recordingLinkSamples).reduce((sum, arr) => sum + arr.length, 0);

    document.getElementById('startRecordingBtn').style.display = 'inline-block';
    document.getElementById('stopRecordingBtn').style.display = 'none';
    document.getElementById('recordingStatus').style.display = 'none';

    if (duration < 0.3 || sampleCount === 0) {
        addLog(`录制时间过短（${duration.toFixed(1)}s），已丢弃`, 'warning');
        recordingLinkSamples = {};
        recordingEvents = [];
        document.getElementById('recordingName').value = '';
        return;
    }

    const name = document.getElementById('recordingName').value.trim() || null;
    document.getElementById('recordingName').value = '';

    const topologySnapshot = {
        devices: devices.map(d => ({ id: d.id, type: d.type, name: d.name, x: d.x, y: d.y })),
        links: links.map(l => ({ id: l.id, from: l.from, to: l.to, bandwidth: l.bandwidth, delay: l.delay, enabled: l.enabled, reservationRatio: l.reservationRatio || 0 })),
        manualRoutes: manualRoutes
    };

    const recordingData = {
        name,
        duration,
        sampleCount,
        eventCount: recordingEvents.length,
        linkSamples: recordingLinkSamples,
        events: recordingEvents,
        topologySnapshot
    };

    saveRecordingToBackend(recordingData);

    addLog(`录制完成，时长 ${duration.toFixed(1)}s，${sampleCount} 个采样点，${recordingEvents.length} 个事件`, 'success');
}

async function saveRecordingToBackend(recordingData) {
    const result = await apiRequest('/recordings', {
        method: 'POST',
        body: JSON.stringify(recordingData)
    });

    if (result.success) {
        addLog(`录制已保存，ID: ${result.data.id}`, 'success');
        loadTrafficRecordings();
    } else {
        addLog('保存录制失败: ' + (result.error || '未知错误'), 'error');
    }
}

async function loadTrafficRecordings() {
    const result = await apiRequest('/recordings');
    if (result.success) {
        trafficRecordings = result.data;
        renderRecordingList();
        loadCompareRecordingOptions();
    } else {
        document.getElementById('recordingList').innerHTML =
            '<p class="hint" style="font-size:11px;color:#999;text-align:center;padding:10px 0;">加载失败</p>';
    }
}

function renderRecordingList() {
    const list = document.getElementById('recordingList');

    if (trafficRecordings.length === 0) {
        list.innerHTML = '<p class="hint" style="font-size:11px;color:#999;text-align:center;padding:10px 0;">暂无录制</p>';
        return;
    }

    let html = '';
    trafficRecordings.forEach(rec => {
        const date = new Date(rec.createdAt).toLocaleString();
        html += `
            <div class="recording-item">
                <div class="recording-item-header">
                    <span class="recording-item-name" title="${escapeHtml(rec.name)}">${escapeHtml(rec.name)}</span>
                </div>
                <div class="recording-item-meta">
                    <span>${date}</span>
                    <span>时长: ${rec.duration.toFixed(1)}s</span>
                    <span>事件: ${rec.eventCount}</span>
                </div>
                <div class="recording-item-buttons">
                    <button class="btn btn-small btn-primary" onclick="playRecording(${rec.id})">回放</button>
                    <button class="btn btn-small btn-danger" onclick="deleteRecording(${rec.id})">删除</button>
                </div>
            </div>
        `;
    });

    list.innerHTML = html;
}

window.playRecording = async function(recordingId) {
    if (isRecording) {
        alert('正在录制中，请先停止录制');
        return;
    }
    if (isPlayback) {
        exitPlayback();
    }

    const result = await apiRequest('/recordings/' + recordingId);
    if (!result.success) {
        alert('加载录制失败: ' + (result.error || '未知错误'));
        return;
    }

    playbackData = result.data;

    if (!playbackData.duration || playbackData.duration <= 0) {
        alert('录制时长无效，无法回放');
        return;
    }

    if (!playbackData.linkSamples || Object.keys(playbackData.linkSamples).length === 0) {
        alert('该录制没有链路采样数据，无法回放');
        return;
    }

    isPlayback = true;
    playbackPaused = false;
    playbackCurrentTime = 0;
    playbackLinkLoads.clear();
    playbackCongestion.clear();

    document.getElementById('playbackOverlay').style.display = 'block';
    document.getElementById('eventTimeline').style.display = 'block';
    document.getElementById('playbackRecordingName').textContent = playbackData.name;
    document.getElementById('playbackTotalTime').textContent = playbackData.duration.toFixed(1) + 's';

    document.getElementById('injectBtn').disabled = true;
    document.getElementById('injectBtn').style.opacity = '0.5';

    renderEventTimeline();
    applyPlaybackFrame();
    startPlaybackTimer();
    addLog(`开始回放: ${playbackData.name}`, 'info');
};

window.deleteRecording = async function(recordingId) {
    if (!confirm('确定要删除这份录制吗？')) return;
    const result = await apiRequest('/recordings/' + recordingId, { method: 'DELETE' });
    if (result.success) {
        addLog('录制已删除', 'success');
        loadTrafficRecordings();
    } else {
        alert('删除失败: ' + (result.error || '未知错误'));
    }
};

function startPlaybackTimer() {
    clearInterval(playbackTimer);
    const tickInterval = 50;
    playbackTimer = setInterval(() => {
        if (playbackPaused || !playbackData) return;

        playbackCurrentTime += tickInterval / 1000;
        if (playbackCurrentTime >= playbackData.duration) {
            playbackCurrentTime = playbackData.duration;
            updatePlaybackUI();
            applyPlaybackFrame();
            addLog('回放结束', 'info');
            clearInterval(playbackTimer);
            playbackTimer = null;
            return;
        }

        updatePlaybackUI();
        applyPlaybackFrame();
    }, tickInterval);
}

function updatePlaybackUI() {
    if (!playbackData || !playbackData.duration || playbackData.duration <= 0) return;
    const pct = Math.min(100, Math.max(0, (playbackCurrentTime / playbackData.duration) * 100));
    if (isNaN(pct) || !isFinite(pct)) return;
    document.getElementById('playbackProgressBar').style.width = pct + '%';
    document.getElementById('playbackSeekBar').value = pct;
    document.getElementById('playbackCurrentTime').textContent = playbackCurrentTime.toFixed(1) + 's';
}

function applyPlaybackFrame() {
    if (!playbackData) return;
    playbackLinkLoads.clear();
    playbackCongestion.clear();

    if (!playbackData.linkSamples) return;

    Object.keys(playbackData.linkSamples).forEach(linkKey => {
        const samples = playbackData.linkSamples[linkKey];
        if (!samples || samples.length === 0) return;

        let closest = samples[0];
        for (let i = 1; i < samples.length; i++) {
            if (Math.abs(samples[i].time - playbackCurrentTime) < Math.abs(closest.time - playbackCurrentTime)) {
                closest = samples[i];
            } else {
                break;
            }
        }

        const [fromId, toId] = linkKey.split('-').map(Number);
        if (isNaN(fromId) || isNaN(toId)) return;
        const link = links.find(l =>
            (l.from === fromId && l.to === toId) ||
            (l.from === toId && l.to === fromId)
        );
        if (link && closest) {
            const load = isNaN(closest.load) ? 0 : closest.load;
            playbackLinkLoads.set(link.id, load);
            if (load > 0.85) {
                playbackCongestion.add(link.id);
            }
        }
    });
}

function togglePlaybackPause() {
    playbackPaused = !playbackPaused;
    document.getElementById('playbackPauseBtn').textContent = playbackPaused ? '继续' : '暂停';
    addLog(playbackPaused ? '回放已暂停' : '回放继续', 'info');
}

function seekPlayback(time) {
    if (!playbackData || !playbackData.duration || playbackData.duration <= 0) return;
    playbackCurrentTime = Math.max(0, Math.min(playbackData.duration, time));
    if (isNaN(playbackCurrentTime)) playbackCurrentTime = 0;
    updatePlaybackUI();
    applyPlaybackFrame();
}

function exitPlayback() {
    isPlayback = false;
    playbackPaused = false;
    clearInterval(playbackTimer);
    playbackTimer = null;
    playbackData = null;
    playbackLinkLoads.clear();
    playbackCongestion.clear();

    document.getElementById('playbackOverlay').style.display = 'none';
    document.getElementById('eventTimeline').style.display = 'none';

    document.getElementById('injectBtn').disabled = false;
    document.getElementById('injectBtn').style.opacity = '1';

    addLog('已退出回放，恢复实时模式', 'info');
}

const originalDrawLink2 = drawLink;
drawLink = function(link) {
    if (!isPlayback) {
        originalDrawLink2(link);
        return;
    }

    const from = devices.find(d => d.id === link.from);
    const to = devices.find(d => d.id === link.to);
    if (!from || !to) return;

    let lineWidth = 2 + (link.bandwidth / 10000) * 6;
    let color = '#52c41a';
    let isDisabled = !link.enabled;

    if (isDisabled) {
        color = '#bfbfbf';
    } else {
        const loadRatio = playbackLinkLoads.get(link.id) || 0;
        const isCongested = playbackCongestion.has(link.id);

        if (loadRatio > 0.85) {
            color = '#ff4d4f';
        } else if (loadRatio > 0.6) {
            color = '#faad14';
        }

        if (isCongested) {
            const flash = Math.sin(Date.now() / 100) > 0;
            if (flash) {
                color = '#ff0000';
            }
        }
    }

    if (selectedLink && selectedLink.id === link.id) {
        lineWidth += 2;
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';

    if (isDisabled) {
        ctx.setLineDash([8, 6]);
    }

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    if (isDisabled) {
        ctx.setLineDash([]);
    }

    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;

    const loadRatio = (playbackLinkLoads.get(link.id) || 0) * 100;
    let label;
    if (isDisabled) {
        label = '已禁用';
    } else {
        label = `${link.bandwidth}Mbps/${link.delay}ms ${loadRatio.toFixed(0)}%`;
    }

    ctx.fillStyle = '#fff';
    ctx.strokeStyle = isDisabled ? '#d9d9d9' : '#999';
    ctx.lineWidth = 1;

    ctx.font = '10px -apple-system, sans-serif';
    const textWidth = ctx.measureText(label).width;

    ctx.fillRect(midX - textWidth / 2 - 4, midY - 7, textWidth + 8, 14);
    ctx.strokeRect(midX - textWidth / 2 - 4, midY - 7, textWidth + 8, 14);

    ctx.fillStyle = isDisabled ? '#bfbfbf' : '#666';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, midX, midY);
};

function renderEventTimeline() {
    if (!playbackData) return;

    const eventsContainer = document.getElementById('eventTimelineEvents');
    const track = document.getElementById('eventTimelineTrack');
    const trackWidth = track.clientWidth || 800;
    const duration = playbackData.duration || 1;

    const eventTypeLabels = {
        'inject': '流量注入',
        'complete': '流量完成',
        'congestion-start': '拥塞开始',
        'congestion-end': '拥塞结束',
        'loss': '丢包'
    };

    let html = '';
    playbackData.events.forEach((event, idx) => {
        const left = (event.time / duration) * 100;
        let tooltip = `${eventTypeLabels[event.type] || event.type} @ T+${event.time.toFixed(1)}s`;
        if (event.linkName) tooltip += `\n链路: ${event.linkName}`;
        if (event.flowSrc && event.flowDst) tooltip += `\n流量: ${event.flowSrc} → ${event.flowDst}`;

        html += `
            <div class="event-marker event-${event.type}" 
                 style="left: ${left}%;"
                 data-event-idx="${idx}"
                 onclick="jumpToEvent(${event.time})"
                 title="${escapeHtml(tooltip)}">
                <div class="event-tooltip">${escapeHtml(tooltip).replace(/\n/g, '<br>')}</div>
            </div>
        `;
    });

    eventsContainer.innerHTML = html;
}

window.jumpToEvent = function(time) {
    seekPlayback(time);
    if (playbackPaused) {
        togglePlaybackPause();
    }
};

async function loadCompareRecordingOptions() {
    const select1 = document.getElementById('compareRecording1');
    const select2 = document.getElementById('compareRecording2');

    if (trafficRecordings.length === 0) {
        select1.innerHTML = '<option value="">暂无录制</option>';
        select2.innerHTML = '<option value="">暂无录制</option>';
        return;
    }

    select1.innerHTML = '<option value="">选择录制 A</option>';
    select2.innerHTML = '<option value="">选择录制 B</option>';

    trafficRecordings.forEach(rec => {
        const date = new Date(rec.createdAt).toLocaleString();
        const label = `${rec.name} - ${date}`;

        const opt1 = document.createElement('option');
        opt1.value = rec.id;
        opt1.textContent = label;
        select1.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = rec.id;
        opt2.textContent = label;
        select2.appendChild(opt2);
    });
}

async function doCompareRecordings() {
    const id1 = parseInt(document.getElementById('compareRecording1').value);
    const id2 = parseInt(document.getElementById('compareRecording2').value);

    if (!id1 || !id2) {
        alert('请选择两份录制');
        return;
    }

    if (id1 === id2) {
        alert('请选择不同的录制进行对比');
        return;
    }

    const result = await apiRequest(`/recordings/compare/${id1}/${id2}`);
    if (result.success) {
        currentCompareRecordingData = result.data;
        renderRecordingCompareResults();
    } else {
        alert('对比失败: ' + (result.error || '未知错误'));
    }
}

function renderRecordingCompareResults() {
    if (!currentCompareRecordingData) return;

    document.getElementById('recordingCompareEmpty').style.display = 'none';
    document.getElementById('recordingCompareResults').style.display = 'block';

    const { recording1, recording2, links } = currentCompareRecordingData;
    const topLinks = links.slice(0, 10);

    const date1 = new Date(recording1.createdAt).toLocaleString();
    const date2 = new Date(recording2.createdAt).toLocaleString();

    const overview = document.getElementById('recordingCompareOverview');
    overview.innerHTML = `
        <div class="report-stat-row">
            <span class="report-stat-label">录制 A</span>
            <span class="report-stat-value">${escapeHtml(recording1.name)}</span>
        </div>
        <div class="report-stat-row">
            <span class="report-stat-label">录制 B</span>
            <span class="report-stat-value">${escapeHtml(recording2.name)}</span>
        </div>
        <div class="report-stat-row">
            <span class="report-stat-label">A 时长</span>
            <span class="report-stat-value">${recording1.duration.toFixed(1)}s</span>
        </div>
        <div class="report-stat-row">
            <span class="report-stat-label">B 时长</span>
            <span class="report-stat-value">${recording2.duration.toFixed(1)}s</span>
        </div>
    `;

    const tableEl = document.getElementById('recordingCompareTable');
    let html = '<div class="recording-compare-header">';
    html += '<span>链路名称</span>';
    html += '<span>平均负载差</span>';
    html += '<span>峰值负载差</span>';
    html += '<span>拥塞时长差</span>';
    html += '</div>';

    topLinks.forEach(link => {
        const avgA = (link.recording1.avgLoad * 100).toFixed(1);
        const avgB = (link.recording2.avgLoad * 100).toFixed(1);
        const avgDiff = link.avgLoadDiff * 100;
        const avgColor = avgDiff > 0 ? '#ff4d4f' : (avgDiff < 0 ? '#52c41a' : '#333');

        const peakA = (link.recording1.peakLoad * 100).toFixed(1);
        const peakB = (link.recording2.peakLoad * 100).toFixed(1);
        const peakDiff = link.peakLoadDiff * 100;
        const peakColor = peakDiff > 0 ? '#ff4d4f' : (peakDiff < 0 ? '#52c41a' : '#333');

        const congA = link.recording1.congestionDuration.toFixed(1);
        const congB = link.recording2.congestionDuration.toFixed(1);
        const congDiff = link.congestionDurationDiff;
        const congColor = congDiff > 0 ? '#ff4d4f' : (congDiff < 0 ? '#52c41a' : '#333');

        html += `<div class="recording-compare-row">
            <span class="recording-compare-link" title="${escapeHtml(link.linkName)}">${escapeHtml(link.linkName)}</span>
            <span class="recording-compare-value" style="color:${avgColor};">
                ${avgA}% → ${avgB}%
                <br><small>(${avgDiff > 0 ? '+' : ''}${avgDiff.toFixed(1)}%)</small>
            </span>
            <span class="recording-compare-value" style="color:${peakColor};">
                ${peakA}% → ${peakB}%
                <br><small>(${peakDiff > 0 ? '+' : ''}${peakDiff.toFixed(1)}%)</small>
            </span>
            <span class="recording-compare-value" style="color:${congColor};">
                ${congA}s → ${congB}s
                <br><small>(${congDiff > 0 ? '+' : ''}${congDiff.toFixed(1)}s)</small>
            </span>
        </div>`;
    });

    if (topLinks.length === 0) {
        html += '<div class="recording-compare-row" style="justify-content:center;color:#999;padding:15px;">无差异数据</div>';
    }

    tableEl.innerHTML = html;
}

const originalInit3 = init;
init = function() {
    originalInit3();
    setupBackendEvents();
    setupConfigAuditEvents();
    setupTrafficRecordingEvents();
    setupSlaEvents();
    loadTopologyVersions();
    loadTrafficRecordings();

    if (devices.length > 0) {
        setTimeout(() => runAudit(), 1000);
    } else {
        showAuditEmpty();
    }
};

let slaContracts = [];
let slaContractIdCounter = 1;
let slaMonitorTimer = null;
let slaViolationEvents = [];
let slaBlinkLinks = new Map();
let slaContractStats = new Map();
let slaEditingContractId = null;
const SLA_MAX_CONTRACTS = 20;
const SLA_MONITOR_INTERVAL = 500;
const SLA_MAX_EVENTS_DISPLAY = 20;

function setupSlaEvents() {
    document.getElementById('slaCreateBtn').addEventListener('click', createSlaContract);
    document.getElementById('slaEditBtn').addEventListener('click', saveSlaEdit);
    document.getElementById('slaCancelEditBtn').addEventListener('click', cancelSlaEdit);
    document.getElementById('slaGenerateReportBtn').addEventListener('click', generateSlaReport);

    const origUpdateDeviceSelects = updateDeviceSelects;
    updateDeviceSelects = function() {
        origUpdateDeviceSelects();
        updateSlaDeviceSelects();
    };

    loadSlaHistoryEvents();
}

async function loadSlaHistoryEvents() {
    try {
        const resp = await apiRequest(`/sla/events?limit=${SLA_MAX_EVENTS_DISPLAY}`, {
            method: 'GET'
        });
        if (resp && resp.success && resp.data && resp.data.length > 0) {
            slaViolationEvents = resp.data.map(e => ({
                timestamp: e.timestamp,
                contractName: e.contractName,
                eventType: e.eventType,
                breachTypes: e.breachTypes || [],
                rootCauseLink: e.rootCauseLink || null,
                duration: e.duration || 0
            }));
            renderSlaEventList();
        }
    } catch (err) {
        console.error('加载SLA历史事件失败:', err);
    }
}

function updateSlaDeviceSelects() {
    const selects = ['slaSrcDevice', 'slaDstDevice'];
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;
        const currentValue = select.value;
        select.innerHTML = '<option value="">请选择</option>';
        devices.forEach(d => {
            const option = document.createElement('option');
            option.value = d.id;
            option.textContent = d.name;
            select.appendChild(option);
        });
        if (currentValue && devices.find(d => d.id == currentValue)) {
            select.value = currentValue;
        }
    });
}

function createSlaContract() {
    if (slaContracts.length >= SLA_MAX_CONTRACTS) {
        alert(`SLA合约数量已达上限（${SLA_MAX_CONTRACTS}条）`);
        return;
    }

    const name = document.getElementById('slaName').value.trim();
    const srcId = parseInt(document.getElementById('slaSrcDevice').value);
    const dstId = parseInt(document.getElementById('slaDstDevice').value);
    const maxLatency = parseFloat(document.getElementById('slaMaxLatency').value);
    const maxLossRate = parseFloat(document.getElementById('slaMaxLossRate').value);
    const minBandwidth = parseFloat(document.getElementById('slaMinBandwidth').value);

    if (!name) { alert('请输入合约名称'); return; }
    if (!srcId || !dstId) { alert('请选择源设备和目的设备'); return; }
    if (srcId === dstId) { alert('源设备和目的设备不能相同'); return; }
    if (isNaN(maxLatency) || maxLatency <= 0) { alert('最大延迟必须大于0'); return; }
    if (isNaN(maxLossRate) || maxLossRate < 0 || maxLossRate > 100) { alert('最大丢包率范围0-100'); return; }
    if (isNaN(minBandwidth) || minBandwidth <= 0) { alert('最低带宽必须大于0'); return; }

    const path = getPath(srcId, dstId);
    if (!path) {
        alert('源到目的不可达，无法创建SLA合约');
        return;
    }

    const contract = {
        id: slaContractIdCounter++,
        name,
        srcDeviceId: srcId,
        dstDeviceId: dstId,
        maxLatency,
        maxLossRate,
        minBandwidth,
        path,
        isViolating: false,
        violationTypes: [],
        rootCauses: [],
        lastViolationSnapshot: null,
        monitoring: true,
        createdAt: Date.now(),
        violationStartTime: null
    };

    slaContracts.push(contract);
    slaContractStats.set(contract.id, {
        complianceMs: 0,
        violationMs: 0,
        violationCount: 0,
        violationDurations: [],
        rootCauseLinks: []
    });

    document.getElementById('slaName').value = '';
    startSlaMonitor();
    renderSlaContractList();
    addLog(`SLA合约已创建: ${name}`, 'success');
}

function editSlaContract(contractId) {
    const contract = slaContracts.find(c => c.id === contractId);
    if (!contract) return;

    slaEditingContractId = contractId;
    document.getElementById('slaName').value = contract.name;
    document.getElementById('slaSrcDevice').value = contract.srcDeviceId;
    document.getElementById('slaDstDevice').value = contract.dstDeviceId;
    document.getElementById('slaMaxLatency').value = contract.maxLatency;
    document.getElementById('slaMaxLossRate').value = contract.maxLossRate;
    document.getElementById('slaMinBandwidth').value = contract.minBandwidth;

    document.getElementById('slaCreateBtn').style.display = 'none';
    document.getElementById('slaEditBtn').style.display = 'inline-block';
    document.getElementById('slaCancelEditBtn').style.display = 'inline-block';
}

function saveSlaEdit() {
    if (!slaEditingContractId) return;
    const contract = slaContracts.find(c => c.id === slaEditingContractId);
    if (!contract) return;

    const name = document.getElementById('slaName').value.trim();
    const srcId = parseInt(document.getElementById('slaSrcDevice').value);
    const dstId = parseInt(document.getElementById('slaDstDevice').value);
    const maxLatency = parseFloat(document.getElementById('slaMaxLatency').value);
    const maxLossRate = parseFloat(document.getElementById('slaMaxLossRate').value);
    const minBandwidth = parseFloat(document.getElementById('slaMinBandwidth').value);

    if (!name) { alert('请输入合约名称'); return; }
    if (!srcId || !dstId) { alert('请选择源设备和目的设备'); return; }
    if (srcId === dstId) { alert('源设备和目的设备不能相同'); return; }

    contract.name = name;
    contract.srcDeviceId = srcId;
    contract.dstDeviceId = dstId;
    contract.maxLatency = maxLatency;
    contract.maxLossRate = maxLossRate;
    contract.minBandwidth = minBandwidth;

    const newPath = getPath(srcId, dstId);
    contract.path = newPath;
    if (!newPath) {
        addLog(`SLA合约 ${name} 路径不可达`, 'warning');
    }

    cancelSlaEdit();
    renderSlaContractList();
    addLog(`SLA合约已更新: ${name}`, 'success');
}

function cancelSlaEdit() {
    slaEditingContractId = null;
    document.getElementById('slaName').value = '';
    document.getElementById('slaCreateBtn').style.display = 'inline-block';
    document.getElementById('slaEditBtn').style.display = 'none';
    document.getElementById('slaCancelEditBtn').style.display = 'none';
}

function deleteSlaContract(contractId) {
    const contract = slaContracts.find(c => c.id === contractId);
    if (!contract) return;

    if (contract.monitoring) {
        if (!confirm(`合约"${contract.name}"正在监控中，确定要删除吗？`)) return;
    }

    slaContracts = slaContracts.filter(c => c.id !== contractId);
    slaContractStats.delete(contractId);

    if (slaContracts.length === 0) {
        stopSlaMonitor();
    }

    if (slaEditingContractId === contractId) {
        cancelSlaEdit();
    }

    renderSlaContractList();
    addLog(`SLA合约已删除: ${contract.name}`, 'info');
}

function startSlaMonitor() {
    if (slaMonitorTimer) return;
    slaMonitorTimer = setInterval(slaMonitorTick, SLA_MONITOR_INTERVAL);
}

function stopSlaMonitor() {
    if (slaContracts.length > 0) return;
    if (slaMonitorTimer) {
        clearInterval(slaMonitorTimer);
        slaMonitorTimer = null;
    }
}

function slaMonitorTick() {
    slaContracts.forEach(contract => {
        if (!contract.monitoring) return;

        contract.path = getPath(contract.srcDeviceId, contract.dstDeviceId);

        const stats = slaContractStats.get(contract.id);
        if (!stats) return;

        if (!contract.path || !contract.path.segments || contract.path.segments.length === 0) {
            const wasViolating = contract.isViolating;
            contract.isViolating = true;
            contract.violationTypes = ['unreachable'];
            contract.rootCauses = [{ type: 'unreachable', linkId: null, linkName: '无可用路径', details: '源到目的不可达' }];
            if (!wasViolating) {
                stats.violationCount++;
                contract.violationStartTime = Date.now();
                contract.lastViolationSnapshot = {
                    violationTypes: contract.violationTypes.slice(),
                    rootCauses: JSON.parse(JSON.stringify(contract.rootCauses))
                };
                stats.rootCauseLinks.push(null);
                recordSlaViolationEvent(contract);
            }
            stats.violationMs += SLA_MONITOR_INTERVAL;
            return;
        }

        const metrics = calculateSlaMetrics(contract);
        const result = evaluateSlaCompliance(contract, metrics);

        const wasViolating = contract.isViolating;
        contract.isViolating = result.isViolating;
        contract.violationTypes = result.violationTypes;
        contract.rootCauses = result.rootCauses;
        contract.currentMetrics = metrics;

        if (result.isViolating) {
            stats.violationMs += SLA_MONITOR_INTERVAL;
            if (!wasViolating) {
                stats.violationCount++;
                contract.violationStartTime = Date.now();
                contract.lastViolationSnapshot = {
                    violationTypes: result.violationTypes.slice(),
                    rootCauses: JSON.parse(JSON.stringify(result.rootCauses))
                };
                result.rootCauses.forEach(rc => {
                    stats.rootCauseLinks.push(rc.linkId || null);
                });
                recordSlaViolationEvent(contract);
            }
        } else {
            stats.complianceMs += SLA_MONITOR_INTERVAL;
            if (wasViolating) {
                const duration = contract.violationStartTime ? Date.now() - contract.violationStartTime : 0;
                stats.violationDurations.push(duration);
                recordSlaRecoveryEvent(contract, duration);
                contract.violationStartTime = null;
                contract.lastViolationSnapshot = null;
            }
        }
    });

    slaBlinkLinks.forEach((info, linkId) => {
        if (Date.now() - info.startTime > 5000) {
            slaBlinkLinks.delete(linkId);
        }
    });

    renderSlaContractList();
}

function calculateSlaMetrics(contract) {
    const path = contract.path;
    if (!path || !path.segments || path.segments.length === 0) {
        return { latency: Infinity, lossRate: 100, availableBandwidth: 0 };
    }

    let latency = 0;
    path.segments.forEach(seg => {
        latency += seg.link.delay;
    });

    let passThroughProduct = 1;
    path.segments.forEach(seg => {
        const congestionState = congestionStates.get(seg.link.id);
        if (congestionState && congestionState.packetLossActive) {
            passThroughProduct *= (1 - 0.2);
        }
    });
    const lossRate = (1 - passThroughProduct) * 100;

    let availableBandwidth = Infinity;
    path.segments.forEach(seg => {
        const link = seg.link;
        const currentLoad = getLinkLoad(link.id);
        const usedBw = currentLoad * link.bandwidth;
        const remaining = link.bandwidth - usedBw;
        if (remaining < availableBandwidth) {
            availableBandwidth = remaining;
        }
    });

    return { latency, lossRate, availableBandwidth };
}

function evaluateSlaCompliance(contract, metrics) {
    const violationTypes = [];
    const rootCauses = [];
    const path = contract.path;

    if (metrics.latency > contract.maxLatency) {
        violationTypes.push('latency');
        let maxDelay = 0;
        let maxDelayLink = null;
        const breakdown = [];
        path.segments.forEach(seg => {
            breakdown.push({ linkId: seg.link.id, delay: seg.link.delay, name: getLinkDisplayName(seg.link.id) });
            if (seg.link.delay > maxDelay) {
                maxDelay = seg.link.delay;
                maxDelayLink = seg.link;
            }
        });
        rootCauses.push({
            type: 'latency',
            linkId: maxDelayLink ? maxDelayLink.id : null,
            linkName: maxDelayLink ? getLinkDisplayName(maxDelayLink.id) : '未知',
            details: `延迟${maxDelay}ms (占比${path.segments.length > 0 ? (maxDelay / metrics.latency * 100).toFixed(1) : 0}%)`,
            breakdown
        });
    }

    if (metrics.lossRate > contract.maxLossRate) {
        violationTypes.push('loss_rate');
        let congestedLink = null;
        for (const seg of path.segments) {
            const congestionState = congestionStates.get(seg.link.id);
            if (congestionState && congestionState.packetLossActive) {
                congestedLink = seg.link;
                break;
            }
        }
        rootCauses.push({
            type: 'loss_rate',
            linkId: congestedLink ? congestedLink.id : null,
            linkName: congestedLink ? getLinkDisplayName(congestedLink.id) : '未知',
            details: `丢包率${metrics.lossRate.toFixed(1)}% > 阈值${contract.maxLossRate}%`
        });
    }

    if (metrics.availableBandwidth < contract.minBandwidth) {
        violationTypes.push('bandwidth');
        let minBwLink = null;
        let minBw = Infinity;
        path.segments.forEach(seg => {
            const link = seg.link;
            const currentLoad = getLinkLoad(link.id);
            const remaining = link.bandwidth - currentLoad * link.bandwidth;
            if (remaining < minBw) {
                minBw = remaining;
                minBwLink = link;
            }
        });
        rootCauses.push({
            type: 'bandwidth',
            linkId: minBwLink ? minBwLink.id : null,
            linkName: minBwLink ? getLinkDisplayName(minBwLink.id) : '未知',
            details: `剩余带宽${minBw.toFixed(1)}Mbps < 最低${contract.minBandwidth}Mbps`
        });
    }

    return {
        isViolating: violationTypes.length > 0,
        violationTypes,
        rootCauses
    };
}

function recordSlaViolationEvent(contract) {
    const breachTypes = contract.violationTypes.slice();
    const rootCause = contract.rootCauses.length > 0 ? contract.rootCauses[0] : null;

    const event = {
        timestamp: Date.now(),
        contractName: contract.name,
        eventType: 'violation',
        breachTypes,
        rootCauseLink: rootCause ? rootCause.linkName : null,
        duration: 0
    };

    slaViolationEvents.unshift(event);
    if (slaViolationEvents.length > SLA_MAX_EVENTS_DISPLAY) {
        slaViolationEvents = slaViolationEvents.slice(0, SLA_MAX_EVENTS_DISPLAY);
    }

    saveSlaEventToBackend(event);

    contract.rootCauses.forEach(rc => {
        if (rc.linkId) {
            slaBlinkLinks.set(rc.linkId, { startTime: Date.now() });
        }
    });

    addLog(`SLA违约: ${contract.name} - ${breachTypes.map(t => ({latency:'延迟',loss_rate:'丢包',bandwidth:'带宽',unreachable:'不可达'}[t] || t)).join(',')}`, 'error');
    renderSlaEventList();
}

function recordSlaRecoveryEvent(contract, duration) {
    const snapshot = contract.lastViolationSnapshot;
    const breachTypes = snapshot ? snapshot.violationTypes : [];
    const rootCause = snapshot && snapshot.rootCauses && snapshot.rootCauses.length > 0 ? snapshot.rootCauses[0] : null;

    const event = {
        timestamp: Date.now(),
        contractName: contract.name,
        eventType: 'recovery',
        breachTypes,
        rootCauseLink: rootCause ? rootCause.linkName : null,
        duration: duration
    };

    slaViolationEvents.unshift(event);
    if (slaViolationEvents.length > SLA_MAX_EVENTS_DISPLAY) {
        slaViolationEvents = slaViolationEvents.slice(0, SLA_MAX_EVENTS_DISPLAY);
    }

    saveSlaEventToBackend(event);

    const breachLabel = breachTypes.map(t => ({latency:'延迟',loss_rate:'丢包',bandwidth:'带宽',unreachable:'不可达'}[t] || t)).join(',') || '未知';
    addLog(`SLA恢复: ${contract.name} - 类型[${breachLabel}]持续${(duration / 1000).toFixed(1)}s`, 'success');
    renderSlaEventList();
}

async function saveSlaEventToBackend(event) {
    await apiRequest('/sla/events', {
        method: 'POST',
        body: JSON.stringify(event)
    });
}

function highlightSlaRootCause(linkId) {
    const link = links.find(l => l.id === linkId);
    if (!link) return;

    clearHighlight();
    highlightedElements.links.push(link);
    slaBlinkLinks.set(linkId, { startTime: Date.now() });

    highlightTimer = setTimeout(() => {
        clearHighlight();
    }, 5000);

    addLog(`高亮违约根因链路: ${getLinkDisplayName(linkId)}`, 'info');
}

function renderSlaContractList() {
    const listEl = document.getElementById('slaContractList');
    const countEl = document.getElementById('slaContractCount');

    if (!listEl) return;
    countEl.textContent = slaContracts.length;

    if (slaContracts.length === 0) {
        listEl.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:10px 0;">暂无SLA合约</p>';
        return;
    }

    let html = '';
    slaContracts.forEach(contract => {
        const srcName = getDeviceName(contract.srcDeviceId);
        const dstName = getDeviceName(contract.dstDeviceId);
        const pathStr = contract.path ? getPathNodeNames(contract.path) : '不可达';
        const metrics = contract.currentMetrics || {};

        html += `<div class="sla-contract-item ${contract.isViolating ? 'violating' : ''}">`;
        html += `<div class="sla-contract-item-header">`;
        html += `<span class="sla-contract-name">`;
        html += `<span class="sla-status-icon ${contract.isViolating ? 'violating' : 'compliant'}">${contract.isViolating ? '✗' : '✓'}</span>`;
        html += `${escapeHtml(contract.name)}`;
        html += `</span>`;
        html += `<div class="sla-contract-actions">`;
        html += `<button onclick="editSlaContract(${contract.id})">编辑</button>`;
        html += `<button class="sla-delete-btn" onclick="deleteSlaContract(${contract.id})">删除</button>`;
        html += `</div></div>`;

        html += `<div class="sla-contract-path" title="${escapeHtml(pathStr)}">${srcName} → ${dstName}: ${escapeHtml(pathStr)}</div>`;

        html += `<div class="sla-contract-metrics">`;
        const latencyOk = metrics.latency !== undefined ? metrics.latency <= contract.maxLatency : true;
        html += `<span class="sla-metric ${contract.isViolating && contract.violationTypes.includes('latency') ? 'breach' : (latencyOk ? 'ok' : '')}">延迟: ${metrics.latency !== undefined ? metrics.latency.toFixed(0) + 'ms' : '-'} / ${contract.maxLatency}ms</span>`;

        const lossOk = metrics.lossRate !== undefined ? metrics.lossRate <= contract.maxLossRate : true;
        html += `<span class="sla-metric ${contract.isViolating && contract.violationTypes.includes('loss_rate') ? 'breach' : (lossOk ? 'ok' : '')}">丢包: ${metrics.lossRate !== undefined ? metrics.lossRate.toFixed(1) + '%' : '-'} / ${contract.maxLossRate}%</span>`;

        const bwOk = metrics.availableBandwidth !== undefined ? metrics.availableBandwidth >= contract.minBandwidth : true;
        html += `<span class="sla-metric ${contract.isViolating && contract.violationTypes.includes('bandwidth') ? 'breach' : (bwOk ? 'ok' : '')}">带宽: ${metrics.availableBandwidth !== undefined ? metrics.availableBandwidth.toFixed(1) + 'M' : '-'} / ≥${contract.minBandwidth}M</span>`;
        html += `</div>`;

        if (contract.isViolating && contract.rootCauses.length > 0) {
            html += `<div class="sla-contract-detail">`;
            contract.rootCauses.forEach(rc => {
                const typeLabels = { latency: '延迟违约', loss_rate: '丢包违约', bandwidth: '带宽违约', unreachable: '不可达' };
                html += `<div class="sla-root-cause" ${rc.linkId ? `onclick="highlightSlaRootCause(${rc.linkId})"` : ''}>`;
                html += `<div class="sla-root-cause-title">${typeLabels[rc.type] || rc.type}: ${escapeHtml(rc.linkName)}</div>`;
                html += `<div class="sla-root-cause-detail">${escapeHtml(rc.details)}</div>`;

                if (rc.type === 'latency' && rc.breakdown) {
                    html += `<div class="sla-latency-breakdown"><div class="sla-latency-bar">`;
                    const totalDelay = rc.breakdown.reduce((s, b) => s + b.delay, 0) || 1;
                    const colors = ['#1890ff', '#52c41a', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2', '#fa541c', '#2f54eb'];
                    rc.breakdown.forEach((b, i) => {
                        const pct = (b.delay / totalDelay * 100).toFixed(1);
                        html += `<div class="sla-latency-segment" style="width:${pct}%;background:${colors[i % colors.length]}" title="${escapeHtml(b.name)}: ${b.delay}ms (${pct}%)"></div>`;
                    });
                    html += `</div></div>`;
                }

                html += `</div>`;
            });
            html += `</div>`;
        }

        html += `</div>`;
    });

    listEl.innerHTML = html;
}

function renderSlaEventList() {
    const listEl = document.getElementById('slaEventList');
    if (!listEl) return;

    if (slaViolationEvents.length === 0) {
        listEl.innerHTML = '<p class="hint" style="font-size:11px;color:#999;text-align:center;padding:8px 0;">暂无事件</p>';
        return;
    }

    let html = '';
    slaViolationEvents.forEach(event => {
        const time = new Date(event.timestamp).toLocaleTimeString();
        const isViolation = event.eventType === 'violation';
        const typeLabels = { latency: '延迟', loss_rate: '丢包', bandwidth: '带宽', unreachable: '不可达' };
        const breachLabel = event.breachTypes.map(t => typeLabels[t] || t).join(',');

        html += `<div class="sla-event-item ${isViolation ? 'violation' : 'recovery'}">`;
        html += `<div class="sla-event-time">${time}</div>`;
        if (isViolation) {
            html += `<div class="sla-event-detail">违约: ${escapeHtml(event.contractName)} - ${breachLabel}</div>`;
            if (event.rootCauseLink) {
                html += `<div class="sla-event-cause">根因: ${escapeHtml(event.rootCauseLink)}</div>`;
            }
        } else {
            html += `<div class="sla-event-detail">恢复: ${escapeHtml(event.contractName)} - 违约持续${(event.duration / 1000).toFixed(1)}s</div>`;
        }
        html += `</div>`;
    });

    listEl.innerHTML = html;
}

function generateSlaReport() {
    if (slaContracts.length === 0) {
        alert('暂无SLA合约，无法生成报告');
        return;
    }

    const reportData = [];
    slaContracts.forEach(contract => {
        const stats = slaContractStats.get(contract.id);
        if (!stats) return;

        const totalMs = stats.complianceMs + stats.violationMs;
        const complianceRate = totalMs > 0 ? (stats.complianceMs / totalMs * 100) : 100;
        const avgViolationDuration = stats.violationDurations.length > 0
            ? stats.violationDurations.reduce((a, b) => a + b, 0) / stats.violationDurations.length / 1000
            : 0;

        const linkCountMap = new Map();
        stats.rootCauseLinks.forEach(linkId => {
            linkCountMap.set(linkId, (linkCountMap.get(linkId) || 0) + 1);
        });
        let mostFrequentRootCause = '-';
        let maxCount = 0;
        linkCountMap.forEach((count, linkId) => {
            if (count > maxCount) {
                maxCount = count;
                mostFrequentRootCause = linkId === null ? '不可达(无可用路径)' : getLinkDisplayName(linkId);
            }
        });

        reportData.push({
            name: contract.name,
            src: getDeviceName(contract.srcDeviceId),
            dst: getDeviceName(contract.dstDeviceId),
            complianceDuration: (stats.complianceMs / 1000).toFixed(1) + 's',
            violationDuration: (stats.violationMs / 1000).toFixed(1) + 's',
            complianceRate: complianceRate.toFixed(1) + '%',
            violationCount: stats.violationCount,
            avgViolationDuration: avgViolationDuration.toFixed(1) + 's',
            mostFrequentRootCause
        });
    });

    renderSlaReport(reportData);
    addLog('SLA报告已生成', 'success');
}

function renderSlaReport(reportData) {
    const container = document.getElementById('slaReportContent');
    if (!container) return;
    container.style.display = 'block';

    let html = '<table class="sla-report-table"><thead><tr>';
    html += '<th>合约</th><th>源</th><th>目的</th><th>达标时长</th><th>违约时长</th><th>达标率</th><th>违约次数</th><th>平均违约时长</th><th>最频根因</th>';
    html += '</tr></thead><tbody>';

    reportData.forEach(row => {
        html += `<tr>`;
        html += `<td>${escapeHtml(row.name)}</td>`;
        html += `<td>${escapeHtml(row.src)}</td>`;
        html += `<td>${escapeHtml(row.dst)}</td>`;
        html += `<td>${row.complianceDuration}</td>`;
        html += `<td>${row.violationDuration}</td>`;
        html += `<td>${row.complianceRate}</td>`;
        html += `<td>${row.violationCount}</td>`;
        html += `<td>${row.avgViolationDuration}</td>`;
        html += `<td>${escapeHtml(row.mostFrequentRootCause)}</td>`;
        html += `</tr>`;
    });

    html += '</tbody></table>';
    html += `<div class="sla-report-export"><button class="btn btn-small" onclick="exportSlaReport()">导出JSON</button></div>`;

    container.innerHTML = html;
}

window.exportSlaReport = function() {
    const reportData = [];
    slaContracts.forEach(contract => {
        const stats = slaContractStats.get(contract.id);
        if (!stats) return;
        const totalMs = stats.complianceMs + stats.violationMs;
        const complianceRate = totalMs > 0 ? (stats.complianceMs / totalMs * 100) : 100;
        const avgViolationDuration = stats.violationDurations.length > 0
            ? stats.violationDurations.reduce((a, b) => a + b, 0) / stats.violationDurations.length / 1000
            : 0;
        const linkCountMap = new Map();
        stats.rootCauseLinks.forEach(linkId => {
            linkCountMap.set(linkId, (linkCountMap.get(linkId) || 0) + 1);
        });
        let mostFrequentRootCause = '-';
        let maxCount = 0;
        linkCountMap.forEach((count, linkId) => {
            if (count > maxCount) {
                maxCount = count;
                mostFrequentRootCause = linkId === null ? '不可达(无可用路径)' : getLinkDisplayName(linkId);
            }
        });
        reportData.push({
            name: contract.name,
            src: getDeviceName(contract.srcDeviceId),
            dst: getDeviceName(contract.dstDeviceId),
            complianceDurationSec: stats.complianceMs / 1000,
            violationDurationSec: stats.violationMs / 1000,
            complianceRate: complianceRate,
            violationCount: stats.violationCount,
            avgViolationDurationSec: avgViolationDuration,
            mostFrequentRootCause
        });
    });

    const json = JSON.stringify(reportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sla_report_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('SLA报告已导出', 'success');
};

window.editSlaContract = editSlaContract;
window.deleteSlaContract = deleteSlaContract;
window.highlightSlaRootCause = highlightSlaRootCause;

const originalDrawLinkSla = drawLink;
drawLink = function(link) {
    const blinkInfo = slaBlinkLinks.get(link.id);
    if (blinkInfo) {
        const from = devices.find(d => d.id === link.from);
        const to = devices.find(d => d.id === link.to);
        if (from && to) {
            const elapsed = Date.now() - blinkInfo.startTime;
            if (elapsed < 5000) {
                const flash = Math.sin(elapsed / 100 * Math.PI) > 0;
                ctx.save();
                ctx.strokeStyle = flash ? '#ff0000' : '#ffff00';
                ctx.lineWidth = 10;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(from.x, from.y);
                ctx.lineTo(to.x, to.y);
                ctx.stroke();
                ctx.restore();
            }
        }
    }
    originalDrawLinkSla(link);
};

let currentMigrationTask = null;
let selectedMigrationFlows = [];
let migrationBatches = [];
let currentPreviewResult = null;
let migrationHistory = [];
let isMigrationExecuting = false;
let currentExecutingBatch = null;
let preMigrationSnapshot = null;

function openMigrationModal() {
    const modal = document.getElementById('migrationModal');
    modal.style.display = 'block';
    loadMigrationTaskList();
    renderMigrationFlowSelect();
    renderMigrationBatches();
    switchMigrationTab('create');
    resetMigrationForm();
}

function closeMigrationModal() {
    document.getElementById('migrationModal').style.display = 'none';
}

function resetMigrationForm() {
    document.getElementById('migrationTaskName').value = '';
    document.getElementById('migrationTaskDesc').value = '';
    selectedMigrationFlows = [];
    migrationBatches = [];
    currentPreviewResult = null;
    document.getElementById('migrationPreviewSection').style.display = 'none';
    document.getElementById('executeMigrationBtn').style.display = 'none';
    document.getElementById('migrationDetailView').style.display = 'none';
    document.querySelectorAll('.migration-tab-content').forEach(c => c.style.display = 'none');
    document.getElementById('migration-tab-create').style.display = 'block';
    renderMigrationFlowSelect();
    renderMigrationTargetSetting();
    renderMigrationBatches();
    updateMigrationFlowCount();
}

function switchMigrationTab(tabName) {
    document.querySelectorAll('.migration-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.migrationTab === tabName);
    });

    document.querySelectorAll('.migration-tab-content').forEach(content => {
        content.style.display = 'none';
    });

    document.getElementById('migration-tab-' + tabName).style.display = 'block';
    document.getElementById('migrationDetailView').style.display = 'none';

    if (tabName === 'history') {
        loadMigrationHistory();
    }
}

function renderMigrationFlowSelect() {
    const container = document.getElementById('migrationFlowSelect');

    if (trafficFlows.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:10px 0;">暂无活跃流量，请先注入流量</p>';
        return;
    }

    let html = '<div class="migration-flow-list">';

    trafficFlows.forEach(flow => {
        const srcDev = devices.find(d => d.id === flow.srcId);
        const dstDev = devices.find(d => d.id === flow.dstId);
        const isSelected = selectedMigrationFlows.some(f => f.flowId === flow.id);

        html += `
            <div class="migration-flow-item ${isSelected ? 'selected' : ''}" 
                 onclick="toggleMigrationFlow(${flow.id})">
                <div class="migration-flow-checkbox">${isSelected ? '✓' : ''}</div>
                <div class="migration-flow-info">
                    <div class="migration-flow-title">
                        <span class="flow-dot" style="background:${flow.color}"></span>
                        ${srcDev?.name || flow.srcId} → ${dstDev?.name || flow.dstId}
                    </div>
                    <div class="migration-flow-subtitle">
                        ${(flow.rate / 1000000).toFixed(1)} Mbps · ${flow.priority === 'priority' ? '优先' : '普通'}
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

function toggleMigrationFlow(flowId) {
    const flow = trafficFlows.find(f => f.id === flowId);
    if (!flow) return;

    const index = selectedMigrationFlows.findIndex(f => f.flowId === flowId);

    if (index >= 0) {
        selectedMigrationFlows.splice(index, 1);
    } else {
        const currentPath = getFlowCurrentPath(flow);
        const srcDev = devices.find(d => d.id === flow.srcId);
        const dstDev = devices.find(d => d.id === flow.dstId);

        selectedMigrationFlows.push({
            flowId: flow.id,
            srcId: flow.srcId,
            dstId: flow.dstId,
            srcName: srcDev?.name,
            dstName: dstDev?.name,
            rate: flow.rate,
            priority: flow.priority,
            targetType: 'path',
            targetPath: currentPath,
            targetNextHop: null,
            targetNextHopName: null,
            originalPath: currentPath,
            originalNextHop: currentPath && currentPath.length > 1 ? currentPath[1] : null,
            slaContractName: getFlowSlaContract(flow)
        });
    }

    renderMigrationFlowSelect();
    renderMigrationTargetSetting();
    updateMigrationFlowCount();
}

function getFlowCurrentPath(flow) {
    const result = dijkstra(flow.srcId);
    const path = [];
    let current = flow.dstId;

    while (current !== null && current !== undefined) {
        path.unshift(current);
        current = result.prev[current];
    }

    if (path[0] === flow.srcId && path[path.length - 1] === flow.dstId) {
        return path;
    }

    return [flow.srcId, flow.dstId];
}

function getFlowSlaContract(flow) {
    const contract = slaContracts?.find(c =>
        c.srcDeviceId === flow.srcId && c.dstDeviceId === flow.dstId
    );
    return contract?.name || null;
}

function updateMigrationFlowCount() {
    document.getElementById('migrationFlowCount').textContent = `已选 ${selectedMigrationFlows.length} 条`;
}

function renderMigrationTargetSetting() {
    const container = document.getElementById('migrationTargetSetting');

    if (selectedMigrationFlows.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:10px 0;">请先选择业务流</p>';
        return;
    }

    let html = '<div class="migration-target-list">';

    selectedMigrationFlows.forEach((flowItem, index) => {
        const targetNextHopOptions = getNextHopOptions(flowItem.srcId);

        html += `
            <div class="migration-target-item">
                <div class="migration-target-header">
                    <span class="migration-target-title">
                        ${flowItem.srcName || flowItem.srcId} → ${flowItem.dstName || flowItem.dstId}
                    </span>
                    <span class="migration-target-rate">${(flowItem.rate / 1000000).toFixed(1)} Mbps</span>
                </div>
                <div class="migration-target-type">
                    <label>
                        <input type="radio" name="targetType_${index}" value="path"
                               ${flowItem.targetType === 'path' ? 'checked' : ''}
                               onchange="setFlowTargetType(${index}, 'path')">
                        指定完整路径
                    </label>
                    <label>
                        <input type="radio" name="targetType_${index}" value="nexthop"
                               ${flowItem.targetType === 'nexthop' ? 'checked' : ''}
                               onchange="setFlowTargetType(${index}, 'nexthop')">
                        指定下一跳（出口）
                    </label>
                </div>
                ${flowItem.targetType === 'path' ? `
                    <div class="migration-target-path">
                        <span class="hint">当前路径：${formatPath(flowItem.targetPath || flowItem.originalPath)}</span>
                        <div class="migration-target-edit">
                            <button class="btn btn-small" onclick="editFlowTargetPath(${index})">选择路径</button>
                        </div>
                    </div>
                ` : `
                    <div class="migration-target-nexthop">
                        <select onchange="setFlowTargetNextHop(${index}, this.value)">
                            <option value="">选择下一跳</option>
                            ${targetNextHopOptions.map(opt => `
                                <option value="${opt.id}" ${flowItem.targetNextHop === opt.id ? 'selected' : ''}>
                                    ${opt.name}
                                </option>
                            `).join('')}
                        </select>
                    </div>
                `}
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

function getNextHopOptions(deviceId) {
    const neighbors = getNeighbors(deviceId);
    return neighbors.map(n => {
        const dev = devices.find(d => d.id === n.nodeId);
        return {
            id: n.nodeId,
            name: dev?.name || n.nodeId
        };
    });
}

function formatPath(path) {
    if (!path || path.length === 0) return '-';
    return path.map(id => {
        const d = devices.find(dev => dev.id === id);
        return d?.name || id;
    }).join(' → ');
}

function setFlowTargetType(index, type) {
    selectedMigrationFlows[index].targetType = type;
    if (type === 'path') {
        selectedMigrationFlows[index].targetNextHop = null;
        selectedMigrationFlows[index].targetNextHopName = null;
    } else {
        selectedMigrationFlows[index].targetPath = null;
    }
    renderMigrationTargetSetting();
}

function setFlowTargetNextHop(index, nextHopId) {
    const flowItem = selectedMigrationFlows[index];
    flowItem.targetNextHop = parseInt(nextHopId) || null;
    const dev = devices.find(d => d.id === flowItem.targetNextHop);
    flowItem.targetNextHopName = dev?.name || null;

    if (flowItem.targetNextHop) {
        const path = computePathViaNextHop(flowItem.srcId, flowItem.dstId, flowItem.targetNextHop);
        flowItem.targetPath = path;
    }

    renderMigrationTargetSetting();
}

function computePathViaNextHop(srcId, dstId, nextHopId) {
    const link = links.find(l =>
        (l.from === srcId && l.to === nextHopId) ||
        (l.to === srcId && l.from === nextHopId)
    );

    if (!link || !link.enabled) {
        return [srcId, dstId];
    }

    const tempDisable = [];
    links.forEach(l => {
        if (!l.enabled) tempDisable.push(l);
        l.enabled = true;
    });

    const savedFrom = link.from;
    const savedTo = link.to;
    const savedEnabled = link.enabled;

    const result = dijkstra(nextHopId);
    const subPath = [];
    let current = dstId;

    while (current !== null && current !== undefined) {
        subPath.unshift(current);
        current = result.prev[current];
    }

    tempDisable.forEach(l => { l.enabled = false; });

    if (subPath[0] === nextHopId) {
        return [srcId, ...subPath];
    }

    return [srcId, dstId];
}

function editFlowTargetPath(index) {
    const flowItem = selectedMigrationFlows[index];
    alert('路径选择功能：在实际场景中可以通过点击拓扑中的节点来构建路径。\n\n当前使用最短路径作为默认目标路径。您可以通过指定下一跳的方式来改变路径。');
}

function renderMigrationBatches() {
    const container = document.getElementById('migrationBatches');

    if (migrationBatches.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:10px 0;">单批执行，所有流一起切换</p>';
        return;
    }

    let html = '<div class="migration-batch-list">';

    migrationBatches.forEach((batch, index) => {
        html += `
            <div class="migration-batch-item">
                <div class="migration-batch-header">
                    <span>第 ${index + 1} 批</span>
                    <div class="migration-batch-actions">
                        <button class="btn btn-small" onclick="removeBatch(${index})">删除</button>
                    </div>
                </div>
                <div class="migration-batch-flows">
                    ${batch.flowIndices?.length || 0} 条流
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
}

function addBatch() {
    if (selectedMigrationFlows.length === 0) {
        alert('请先选择业务流');
        return;
    }

    const batchNumber = migrationBatches.length + 1;
    migrationBatches.push({
        batchNumber,
        flowIndices: [],
        status: 'pending'
    });

    renderMigrationBatches();
}

function removeBatch(index) {
    migrationBatches.splice(index, 1);
    migrationBatches.forEach((b, i) => {
        b.batchNumber = i + 1;
    });
    renderMigrationBatches();
}

async function previewMigration() {
    const taskName = document.getElementById('migrationTaskName').value.trim();
    if (!taskName) {
        alert('请输入任务名称');
        return;
    }

    if (selectedMigrationFlows.length === 0) {
        alert('请至少选择一条业务流');
        return;
    }

    selectedMigrationFlows.forEach((flow, index) => {
        if (flow.targetType === 'path' && (!flow.targetPath || flow.targetPath.length < 2)) {
            alert(`第 ${index + 1} 条流的目标路径无效`);
            return;
        }
        if (flow.targetType === 'nexthop' && !flow.targetNextHop) {
            alert(`第 ${index + 1} 条流请指定下一跳`);
            return;
        }
    });

    currentPreviewResult = runMigrationPreview();
    renderPreviewResult();

    document.getElementById('migrationPreviewSection').style.display = 'block';
    document.getElementById('executeMigrationBtn').style.display = currentPreviewResult.passed ? 'inline-block' : 'none';
}

function runMigrationPreview() {
    const result = {
        passed: true,
        unreachableFlows: [],
        bandwidthViolations: [],
        slaViolations: [],
        totalFlows: selectedMigrationFlows.length
    };

    const linkBandwidthUsage = new Map();

    links.forEach(link => {
        const key = getLinkKey(link.from, link.to);
        let currentUsageMbps = 0;

        trafficFlows.forEach(flow => {
            if (isFlowUsingLink(flow, link)) {
                currentUsageMbps += flow.rate / 1000000;
            }
        });

        const isInMigration = selectedMigrationFlows.some(f =>
            isFlowUsingLinkById(f.flowId, link)
        );

        if (!isInMigration) {
            linkBandwidthUsage.set(key, currentUsageMbps);
        } else {
            const origFlow = trafficFlows.find(f => f.id === f.flowId);
            if (origFlow) {
                linkBandwidthUsage.set(key, Math.max(0, currentUsageMbps - origFlow.rate / 1000000));
            } else {
                linkBandwidthUsage.set(key, currentUsageMbps);
            }
        }
    });

    selectedMigrationFlows.forEach((flowItem, index) => {
        const targetPath = flowItem.targetPath;
        let isReachable = false;

        if (targetPath && targetPath.length >= 2) {
            isReachable = true;
            for (let i = 0; i < targetPath.length - 1; i++) {
                const link = findLink(targetPath[i], targetPath[i + 1]);
                if (!link || !link.enabled) {
                    isReachable = false;
                    break;
                }
            }
        }

        if (!isReachable) {
            result.unreachableFlows.push({
                index,
                flowId: flowItem.flowId,
                src: flowItem.srcName || flowItem.srcId,
                dst: flowItem.dstName || flowItem.dstId
            });
            result.passed = false;
        } else {
            const flowRateMbps = flowItem.rate / 1000000;
            for (let i = 0; i < targetPath.length - 1; i++) {
                const key = getLinkKey(targetPath[i], targetPath[i + 1]);
                const currentUsageMbps = linkBandwidthUsage.get(key) || 0;
                const newUsageMbps = currentUsageMbps + flowRateMbps;
                linkBandwidthUsage.set(key, newUsageMbps);
            }
        }
    });

    linkBandwidthUsage.forEach((usageMbps, key) => {
        const link = findLinkByKey(key);
        if (link) {
            const bandwidthMbps = link.bandwidth || 100;
            const utilization = (usageMbps / bandwidthMbps) * 100;

            if (utilization > 100) {
                result.bandwidthViolations.push({
                    linkKey: key,
                    linkName: getLinkDisplayNameById(key),
                    bandwidth: bandwidthMbps,
                    usage: usageMbps,
                    utilization: utilization.toFixed(1)
                });
                result.passed = false;
            }
        }
    });

    if (slaContracts && slaContracts.length > 0) {
        slaContracts.forEach(contract => {
            const migrationFlow = selectedMigrationFlows.find(f =>
                f.srcId === contract.srcDeviceId && f.dstId === contract.dstDeviceId
            );

            if (migrationFlow) {
                const pathLatency = calculatePathLatency(migrationFlow.targetPath);
                const pathLossRate = calculatePathLossRate(migrationFlow.targetPath);
                const pathBandwidth = calculatePathBandwidth(migrationFlow.targetPath);

                let violated = false;
                const breachTypes = [];

                if (contract.maxLatency && pathLatency > contract.maxLatency) {
                    violated = true;
                    breachTypes.push({
                        type: 'latency',
                        expected: contract.maxLatency,
                        actual: pathLatency.toFixed(2)
                    });
                }

                if (contract.maxLossRate && pathLossRate > contract.maxLossRate) {
                    violated = true;
                    breachTypes.push({
                        type: 'lossRate',
                        expected: contract.maxLossRate,
                        actual: pathLossRate.toFixed(2)
                    });
                }

                if (contract.minBandwidth && pathBandwidth < contract.minBandwidth) {
                    violated = true;
                    breachTypes.push({
                        type: 'bandwidth',
                        expected: contract.minBandwidth,
                        actual: pathBandwidth.toFixed(2)
                    });
                }

                if (violated) {
                    result.slaViolations.push({
                        contractName: contract.name,
                        src: getDeviceName(contract.srcDeviceId),
                        dst: getDeviceName(contract.dstDeviceId),
                        breachTypes
                    });
                    result.passed = false;
                }
            }
        });
    }

    return result;
}

function isFlowUsingLink(flow, link) {
    const path = getFlowCurrentPath(flow);
    for (let i = 0; i < path.length - 1; i++) {
        if (isSameLink(path[i], path[i + 1], link.from, link.to)) {
            return true;
        }
    }
    return false;
}

function isFlowUsingLinkById(flowId, link) {
    const flow = trafficFlows.find(f => f.id === flowId);
    if (!flow) return false;
    return isFlowUsingLink(flow, link);
}

function isSameLink(a1, a2, b1, b2) {
    return (a1 === b1 && a2 === b2) || (a1 === b2 && a2 === b1);
}

function getLinkKey(from, to) {
    return from < to ? `${from}-${to}` : `${to}-${from}`;
}

function findLink(from, to) {
    return links.find(l => isSameLink(from, to, l.from, l.to));
}

function findLinkByKey(key) {
    const [from, to] = key.split('-').map(Number);
    return findLink(from, to);
}

function getLinkDisplayNameById(key) {
    const link = findLinkByKey(key);
    if (link) {
        const from = devices.find(d => d.id === link.from);
        const to = devices.find(d => d.id === link.to);
        return `${from?.name || link.from} - ${to?.name || link.to}`;
    }
    const parts = key.split('-');
    if (parts.length === 2) {
        const fromId = parseInt(parts[0]);
        const toId = parseInt(parts[1]);
        const from = devices.find(d => d.id === fromId);
        const to = devices.find(d => d.id === toId);
        return `${from?.name || fromId} - ${to?.name || toId}`;
    }
    return key;
}

function calculatePathLatency(path) {
    if (!path || path.length < 2) return 0;
    let latency = 0;
    for (let i = 0; i < path.length - 1; i++) {
        const link = findLink(path[i], path[i + 1]);
        if (link) {
            latency += link.delay || 10;
        }
    }
    return latency;
}

function calculatePathLossRate(path) {
    if (!path || path.length < 2) return 0;
    let lossRate = 0;
    for (let i = 0; i < path.length - 1; i++) {
        const link = findLink(path[i], path[i + 1]);
        if (link) {
            lossRate += link.lossRate || 0;
        }
    }
    return Math.min(lossRate, 100);
}

function calculatePathBandwidth(path) {
    if (!path || path.length < 2) return Infinity;
    let minBandwidth = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
        const link = findLink(path[i], path[i + 1]);
        if (link) {
            minBandwidth = Math.min(minBandwidth, link.bandwidth || 100);
        }
    }
    return minBandwidth === Infinity ? 0 : minBandwidth;
}

function renderPreviewResult() {
    const statusEl = document.getElementById('migrationPreviewStatus');
    const resultEl = document.getElementById('migrationPreviewResult');

    if (!currentPreviewResult) return;

    statusEl.textContent = currentPreviewResult.passed ? '✓ 预演通过' : '✗ 预演未通过';
    statusEl.className = 'migration-preview-status ' + (currentPreviewResult.passed ? 'passed' : 'failed');

    let html = '';

    if (currentPreviewResult.unreachableFlows.length > 0) {
        html += `
            <div class="preview-alert-section error">
                <h5>❌ 不可达的流 (${currentPreviewResult.unreachableFlows.length})</h5>
                <ul>
                    ${currentPreviewResult.unreachableFlows.map(f => `
                        <li>${f.src} → ${f.dst}</li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    if (currentPreviewResult.bandwidthViolations.length > 0) {
        html += `
            <div class="preview-alert-section warning">
                <h5>⚠️ 带宽超限链路 (${currentPreviewResult.bandwidthViolations.length})</h5>
                <ul>
                    ${currentPreviewResult.bandwidthViolations.map(v => `
                        <li>
                            ${v.linkName}: ${v.usage.toFixed(1)} / ${v.bandwidth} Mbps (${v.utilization}%)
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    if (currentPreviewResult.slaViolations.length > 0) {
        html += `
            <div class="preview-alert-section error">
                <h5>❌ SLA违约 (${currentPreviewResult.slaViolations.length})</h5>
                <ul>
                    ${currentPreviewResult.slaViolations.map(v => `
                        <li>
                            <strong>${v.contractName}</strong> (${v.src} → ${v.dst})
                            <ul>
                                ${v.breachTypes.map(b => `
                                    <li>${getBreachTypeName(b.type)}: 预期 ${b.expected}，实际 ${b.actual}</li>
                                `).join('')}
                            </ul>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    if (currentPreviewResult.passed) {
        html += `
            <div class="preview-success-section">
                <p>✅ 所有检查项通过，可以执行迁移</p>
                <p class="hint">共 ${currentPreviewResult.totalFlows} 条业务流参与迁移</p>
            </div>
        `;
    }

    resultEl.innerHTML = html;
}

function getBreachTypeName(type) {
    const names = {
        latency: '延迟',
        lossRate: '丢包率',
        bandwidth: '带宽'
    };
    return names[type] || type;
}

async function saveMigrationDraft() {
    const taskName = document.getElementById('migrationTaskName').value.trim();
    const taskDesc = document.getElementById('migrationTaskDesc').value.trim();

    if (!taskName) {
        alert('请输入任务名称');
        return;
    }

    const snapshot = captureTopologySnapshot();

    const taskData = {
        name: taskName,
        description: taskDesc,
        flows: selectedMigrationFlows,
        batches: migrationBatches.length > 0 ? migrationBatches : null,
        previewResult: currentPreviewResult,
        preMigrationSnapshot: snapshot
    };

    try {
        const result = await apiRequest('/migration/tasks', 'POST', taskData);
        if (result.success) {
            addLog(`迁移任务草稿已保存: ${taskName}`, 'success');
            loadMigrationTaskList();
        }
    } catch (err) {
        console.error('保存失败:', err);
        alert('保存失败: ' + err.message);
    }
}

function captureTopologySnapshot() {
    return {
        devices: JSON.parse(JSON.stringify(devices)),
        links: JSON.parse(JSON.stringify(links)),
        manualRoutes: JSON.parse(JSON.stringify(manualRoutes)),
        trafficFlows: JSON.parse(JSON.stringify(trafficFlows)),
        timestamp: Date.now()
    };
}

async function executeMigration() {
    if (!currentPreviewResult || !currentPreviewResult.passed) {
        alert('预演未通过，无法执行迁移');
        return;
    }

    if (!confirm('确定要执行迁移吗？执行过程中如果出现问题可以回滚。')) {
        return;
    }

    preMigrationSnapshot = captureTopologySnapshot();
    isMigrationExecuting = true;
    document.getElementById('executeMigrationBtn').disabled = true;
    document.getElementById('previewMigrationBtn').disabled = true;

    addLog('开始执行业务流迁移', 'info');

    try {
        if (migrationBatches.length === 0) {
            await executeBatch(selectedMigrationFlows);
            addLog('迁移执行完成', 'success');
        } else {
            for (let i = 0; i < migrationBatches.length; i++) {
                if (!isMigrationExecuting) break;

                currentExecutingBatch = migrationBatches[i];
                const batchFlows = migrationBatches[i].flowIndices?.map(idx => selectedMigrationFlows[idx]) || [];

                addLog(`开始执行第 ${i + 1} 批迁移 (${batchFlows.length} 条流)`, 'info');
                await executeBatch(batchFlows);

                if (i < migrationBatches.length - 1) {
                    const continueResult = checkCanContinueMigration();
                    if (!continueResult.canContinue) {
                        isMigrationExecuting = false;
                        alert(`第 ${i + 1} 批执行后检测到问题，已暂停后续批次：\n${continueResult.reason}\n\n您可以选择回滚或继续。`);
                        showRollbackOption();
                        return;
                    }
                }
            }

            if (isMigrationExecuting) {
                addLog('所有批次迁移执行完成', 'success');
            }
        }

        const postSnapshot = captureTopologySnapshot();
        saveCompletedMigrationTask(postSnapshot);

    } catch (err) {
        console.error('迁移执行失败:', err);
        addLog('迁移执行失败: ' + err.message, 'error');
    } finally {
        isMigrationExecuting = false;
        currentExecutingBatch = null;
        document.getElementById('executeMigrationBtn').disabled = false;
        document.getElementById('previewMigrationBtn').disabled = false;
    }
}

async function executeBatch(flows) {
    return new Promise((resolve) => {
        setTimeout(() => {
            flows.forEach(flowItem => {
                const flow = trafficFlows.find(f => f.id === flowItem.flowId);
                if (flow && flowItem.targetPath) {
                    flow.manualPath = flowItem.targetPath;
                }
            });

            updateLinkCongestion();
            checkFlowCompletion();
            render();
            updateQosStats();

            resolve();
        }, 500);
    });
}

function checkCanContinueMigration() {
    const result = {
        canContinue: true,
        reason: ''
    };

    const unreachableFlows = [];
    trafficFlows.forEach(flow => {
        if (!isFlowReachable(flow)) {
            const srcDev = devices.find(d => d.id === flow.srcId);
            const dstDev = devices.find(d => d.id === flow.dstId);
            unreachableFlows.push(`${srcDev?.name || flow.srcId} → ${dstDev?.name || flow.dstId}`);
        }
    });

    if (unreachableFlows.length > 0) {
        result.canContinue = false;
        result.reason = `检测到 ${unreachableFlows.length} 条不可达的流：\n${unreachableFlows.slice(0, 3).join('\n')}${unreachableFlows.length > 3 ? '\n...' : ''}`;
        return result;
    }

    if (slaContracts && slaContracts.length > 0) {
        const breachedContracts = [];
        slaContracts.forEach(contract => {
            if (isSlaContractBreached(contract)) {
                breachedContracts.push(contract.name);
            }
        });

        if (breachedContracts.length > 0) {
            result.canContinue = false;
            result.reason = `检测到 ${breachedContracts.length} 个SLA合约违约：\n${breachedContracts.slice(0, 3).join('\n')}${breachedContracts.length > 3 ? '\n...' : ''}`;
            return result;
        }
    }

    return result;
}

function isFlowReachable(flow) {
    const result = dijkstra(flow.srcId);
    return result.dist[flow.dstId] !== Infinity;
}

function isSlaContractBreached(contract) {
    const result = dijkstra(contract.srcDeviceId);
    if (result.dist[contract.dstDeviceId] === Infinity) {
        return true;
    }

    if (contract.maxLatency && result.dist[contract.dstDeviceId] > contract.maxLatency) {
        return true;
    }

    return false;
}

function showRollbackOption() {
    if (confirm('是否回滚到迁移前状态？')) {
        rollbackMigration();
    }
}

function rollbackMigration() {
    if (!preMigrationSnapshot) {
        alert('没有迁移前的快照，无法回滚');
        return;
    }

    if (!confirm('确定要回滚到迁移前的状态吗？')) {
        return;
    }

    devices = preMigrationSnapshot.devices;
    links = preMigrationSnapshot.links;
    manualRoutes = preMigrationSnapshot.manualRoutes;
    trafficFlows = preMigrationSnapshot.trafficFlows;

    trafficFlows.forEach(flow => {
        delete flow.manualPath;
    });

    updateDeviceSelects();
    calculatePartitions();
    updateLinkCongestion();
    render();
    updatePropertyPanel();
    updateRoutingTable();
    updateQosStats();
    updateTrafficList();

    isMigrationExecuting = false;
    addLog('已回滚到迁移前状态', 'warning');
    alert('回滚完成');
}

async function saveCompletedMigrationTask(postSnapshot) {
    const taskName = document.getElementById('migrationTaskName').value.trim();
    const taskDesc = document.getElementById('migrationTaskDesc').value.trim();

    const taskData = {
        name: taskName || ('迁移任务_' + Date.now()),
        description: taskDesc,
        flows: selectedMigrationFlows.map(f => ({ ...f, status: 'completed' })),
        batches: migrationBatches.length > 0 ? migrationBatches.map(b => ({ ...b, status: 'completed' })) : null,
        previewResult: currentPreviewResult,
        preMigrationSnapshot: preMigrationSnapshot,
        postMigrationSnapshot: postSnapshot
    };

    try {
        const result = await apiRequest('/migration/tasks', 'POST', taskData);
        if (result.success) {
            addLog('迁移任务已保存到历史记录', 'success');
            loadMigrationTaskList();
            loadMigrationHistory();
        }
    } catch (err) {
        console.error('保存迁移任务失败:', err);
    }
}

async function loadMigrationTaskList() {
    const container = document.getElementById('migrationTaskList');

    try {
        const result = await apiRequest('/migration/tasks');
        if (result.success) {
            const tasks = result.data.slice(0, 10);

            if (tasks.length === 0) {
                container.innerHTML = '<p class="hint" style="font-size:11px;color:#999;text-align:center;padding:10px 0;">暂无历史任务</p>';
                return;
            }

            let html = '';
            tasks.forEach(task => {
                const date = new Date(task.createdAt).toLocaleDateString();
                const statusMap = {
                    'draft': '草稿',
                    'running': '执行中',
                    'completed': '已完成',
                    'failed': '失败',
                    'paused': '已暂停'
                };

                html += `
                    <div class="migration-task-item" onclick="viewMigrationTaskDetail(${task.id})">
                        <div class="migration-task-name">${escapeHtml(task.name)}</div>
                        <div class="migration-task-meta">
                            <span class="migration-task-status ${task.status}">${statusMap[task.status] || task.status}</span>
                            <span>${date}</span>
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
        }
    } catch (err) {
        container.innerHTML = '<p class="hint" style="font-size:11px;color:#999;text-align:center;padding:10px 0;">加载失败</p>';
    }
}

async function loadMigrationHistory() {
    const container = document.getElementById('migrationHistoryList');

    try {
        const result = await apiRequest('/migration/tasks');
        if (result.success) {
            migrationHistory = result.data;

            if (migrationHistory.length === 0) {
                container.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:20px 0;">暂无历史迁移任务</p>';
                return;
            }

            let html = '<div class="migration-history-list">';

            migrationHistory.forEach(task => {
                const date = new Date(task.createdAt).toLocaleString();
                const statusMap = {
                    'draft': '草稿',
                    'running': '执行中',
                    'completed': '已完成',
                    'failed': '失败',
                    'paused': '已暂停'
                };

                html += `
                    <div class="migration-history-item">
                        <div class="migration-history-header">
                            <span class="migration-history-name">${escapeHtml(task.name)}</span>
                            <span class="migration-history-status ${task.status}">${statusMap[task.status] || task.status}</span>
                        </div>
                        <div class="migration-history-meta">
                            <span>${task.totalFlows} 条流</span>
                            <span>${task.totalBatches || 1} 批</span>
                            <span>${date}</span>
                        </div>
                        <div class="migration-history-actions">
                            <button class="btn btn-small" onclick="viewMigrationTaskDetail(${task.id})">查看详情</button>
                            ${task.status === 'completed' ? `
                                <button class="btn btn-small btn-primary" onclick="duplicateMigrationTask(${task.id})">复制为新任务</button>
                            ` : ''}
                        </div>
                    </div>
                `;
            });

            html += '</div>';
            container.innerHTML = html;
        }
    } catch (err) {
        container.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:20px 0;">加载失败</p>';
    }
}

async function viewMigrationTaskDetail(taskId) {
    try {
        const result = await apiRequest('/migration/tasks/' + taskId);
        if (result.success) {
            const task = result.data;
            renderMigrationDetail(task);
        }
    } catch (err) {
        alert('获取任务详情失败: ' + err.message);
    }
}

function renderMigrationDetail(task) {
    document.getElementById('migrationDetailTitle').textContent = task.name;
    document.getElementById('migrationDetailView').style.display = 'block';
    document.querySelectorAll('.migration-tab-content').forEach(c => c.style.display = 'none');

    const statusMap = {
        'draft': '草稿',
        'running': '执行中',
        'completed': '已完成',
        'failed': '失败',
        'paused': '已暂停'
    };

    let html = `
        <div class="migration-detail-section">
            <h4>基本信息</h4>
            <div class="detail-row">
                <span class="detail-label">任务状态</span>
                <span class="migration-task-status ${task.status}">${statusMap[task.status] || task.status}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">创建时间</span>
                <span>${new Date(task.createdAt).toLocaleString()}</span>
            </div>
            ${task.startedAt ? `
                <div class="detail-row">
                    <span class="detail-label">开始时间</span>
                    <span>${new Date(task.startedAt).toLocaleString()}</span>
                </div>
            ` : ''}
            ${task.finishedAt ? `
                <div class="detail-row">
                    <span class="detail-label">完成时间</span>
                    <span>${new Date(task.finishedAt).toLocaleString()}</span>
                </div>
            ` : ''}
            ${task.description ? `
                <div class="detail-row">
                    <span class="detail-label">描述</span>
                    <span>${escapeHtml(task.description)}</span>
                </div>
            ` : ''}
        </div>

        <div class="migration-detail-section">
            <h4>迁移流列表 (${task.flows?.length || 0} 条)</h4>
            <div class="migration-flows-detail">
    `;

    if (task.flows && task.flows.length > 0) {
        task.flows.forEach((flow, index) => {
            html += `
                <div class="migration-flow-detail-item">
                    <div class="flow-detail-header">
                        <span class="flow-detail-title">
                            ${flow.srcName || flow.srcId} → ${flow.dstName || flow.dstId}
                        </span>
                        <span class="flow-detail-rate">${(flow.rate / 1000000).toFixed(1)} Mbps</span>
                    </div>
                    <div class="flow-detail-paths">
                        <div class="flow-path-row">
                            <span class="path-label">原路径:</span>
                            <span class="path-content">${formatPath(flow.originalPath) || '-'}</span>
                        </div>
                        <div class="flow-path-row">
                            <span class="path-label">目标路径:</span>
                            <span class="path-content">${formatPath(flow.targetPath) || '-'}</span>
                        </div>
                    </div>
                </div>
            `;
        });
    } else {
        html += '<p class="hint">暂无流数据</p>';
    }

    html += `
            </div>
        </div>
    `;

    if (task.previewResult) {
        html += `
            <div class="migration-detail-section">
                <h4>预演结果</h4>
                <div class="preview-result-detail">
                    <p>${task.previewResult.passed ? '✅ 预演通过' : '❌ 预演未通过'}</p>
                    ${task.previewResult.unreachableFlows?.length > 0 ? `
                        <p>不可达流: ${task.previewResult.unreachableFlows.length} 条</p>
                    ` : ''}
                    ${task.previewResult.bandwidthViolations?.length > 0 ? `
                        <p>带宽超限链路: ${task.previewResult.bandwidthViolations.length} 条</p>
                    ` : ''}
                    ${task.previewResult.slaViolations?.length > 0 ? `
                        <p>SLA违约: ${task.previewResult.slaViolations.length} 项</p>
                    ` : ''}
                </div>
            </div>
        `;
    }

    if (task.status === 'completed') {
        html += `
            <div class="migration-detail-actions">
                <button class="btn btn-primary" onclick="duplicateMigrationTask(${task.id})">复制为新任务</button>
                <button class="btn btn-danger" onclick="deleteMigrationTask(${task.id})">删除任务</button>
            </div>
        `;
    }

    document.getElementById('migrationDetailContent').innerHTML = html;
}

function backFromMigrationDetail() {
    document.getElementById('migrationDetailView').style.display = 'none';
    const activeTab = document.querySelector('.migration-tab.active')?.dataset.migrationTab || 'create';
    document.getElementById('migration-tab-' + activeTab).style.display = 'block';
}

async function duplicateMigrationTask(taskId) {
    try {
        const result = await apiRequest('/migration/tasks/' + taskId + '/duplicate', 'POST', {});
        if (result.success) {
            addLog(`已复制迁移任务: ${result.data.name}`, 'success');
            alert('复制成功！新任务已保存为草稿。');

            const detailResult = await apiRequest('/migration/tasks/' + result.data.id);
            if (detailResult.success) {
                const task = detailResult.data;
                document.getElementById('migrationTaskName').value = task.name;
                document.getElementById('migrationTaskDesc').value = task.description || '';

                selectedMigrationFlows = task.flows || [];
                migrationBatches = task.batches || [];

                renderMigrationFlowSelect();
                renderMigrationTargetSetting();
                renderMigrationBatches();
                updateMigrationFlowCount();

                switchMigrationTab('create');
                backFromMigrationDetail();
            }
        }
    } catch (err) {
        alert('复制失败: ' + err.message);
    }
}

async function deleteMigrationTask(taskId) {
    if (!confirm('确定要删除这个迁移任务吗？')) return;

    try {
        const result = await apiRequest('/migration/tasks/' + taskId, 'DELETE');
        if (result.success) {
            addLog('迁移任务已删除', 'info');
            backFromMigrationDetail();
            loadMigrationHistory();
            loadMigrationTaskList();
        }
    } catch (err) {
        alert('删除失败: ' + err.message);
    }
}

function initMigrationModule() {
    document.getElementById('openMigrationModalBtn').addEventListener('click', openMigrationModal);
    document.getElementById('closeMigrationModal').addEventListener('click', closeMigrationModal);
    document.getElementById('refreshMigrationListBtn').addEventListener('click', loadMigrationTaskList);
    document.getElementById('previewMigrationBtn').addEventListener('click', previewMigration);
    document.getElementById('executeMigrationBtn').addEventListener('click', executeMigration);
    document.getElementById('saveMigrationDraftBtn').addEventListener('click', saveMigrationDraft);
    document.getElementById('addBatchBtn').addEventListener('click', addBatch);
    document.getElementById('backFromDetailBtn').addEventListener('click', backFromMigrationDetail);

    document.querySelectorAll('.migration-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            switchMigrationTab(tab.dataset.migrationTab);
        });
    });

    document.getElementById('migrationModal').addEventListener('click', (e) => {
        if (e.target.id === 'migrationModal') {
            closeMigrationModal();
        }
    });
}

window.toggleMigrationFlow = toggleMigrationFlow;
window.setFlowTargetType = setFlowTargetType;
window.setFlowTargetNextHop = setFlowTargetNextHop;
window.editFlowTargetPath = editFlowTargetPath;
window.addBatch = addBatch;
window.removeBatch = removeBatch;
window.viewMigrationTaskDetail = viewMigrationTaskDetail;
window.duplicateMigrationTask = duplicateMigrationTask;
window.deleteMigrationTask = deleteMigrationTask;
window.backFromMigrationDetail = backFromMigrationDetail;

let faultPlaybooks = [];
let currentPlaybook = null;
let currentPlaybookEvents = [];

let playbackState = {
    isPlaying: false,
    isPaused: false,
    startTime: 0,
    pausedTime: 0,
    pausedDuration: 0,
    currentEventIndex: 0,
    totalEvents: 0,
    timerId: null,
    prePlaybackLinkStates: [],
    currentPlaybookId: null
};

let resilienceSamples = [];
let samplingTimerId = null;
const SAMPLING_INTERVAL = 200;

let currentResilienceReport = null;

function switchPlaybookTab(tabName) {
    document.querySelectorAll('.playbook-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.playbookTab === tabName);
    });

    document.querySelectorAll('#playbook-tab-editor, #playbook-tab-history').forEach(content => {
        content.style.display = 'none';
    });

    document.getElementById('playbook-tab-' + tabName).style.display = 'block';

    if (tabName === 'history') {
        loadResilienceReportHistory();
    }
}

async function loadFaultPlaybooks() {
    try {
        const result = await apiRequest('/fault-playbooks');
        if (result.success) {
            faultPlaybooks = result.data;
            renderPlaybookSelect();
        }
    } catch (err) {
        console.error('加载故障剧本列表失败:', err);
    }
}

function renderPlaybookSelect() {
    const select = document.getElementById('playbookSelect');
    select.innerHTML = '<option value="">-- 选择/新建 --</option>';

    faultPlaybooks.forEach(playbook => {
        const option = document.createElement('option');
        option.value = playbook.id;
        option.textContent = `${playbook.name} (${playbook.eventCount}个事件)`;
        select.appendChild(option);
    });
}

function onPlaybookSelectChange() {
    const select = document.getElementById('playbookSelect');
    const playbookId = select.value;

    if (playbookId) {
        loadPlaybookDetail(parseInt(playbookId));
    } else {
        clearPlaybookEditor();
    }
}

async function loadPlaybookDetail(playbookId) {
    try {
        const result = await apiRequest('/fault-playbooks/' + playbookId);
        if (result.success && result.data) {
            currentPlaybook = result.data;
            currentPlaybookEvents = [...(result.data.events || [])];

            document.getElementById('playbookName').value = result.data.name;
            document.getElementById('playbookDesc').value = result.data.description || '';

            showPlaybookEditor();
            renderPlaybookEvents();
            updatePlayButtonState();
        }
    } catch (err) {
        console.error('加载剧本详情失败:', err);
        alert('加载剧本详情失败');
    }
}

function clearPlaybookEditor() {
    currentPlaybook = null;
    currentPlaybookEvents = [];

    document.getElementById('playbookName').value = '';
    document.getElementById('playbookDesc').value = '';

    document.getElementById('playbookInfo').style.display = 'none';
    document.getElementById('playbookEventsSection').style.display = 'none';
    document.getElementById('playbookEmpty').style.display = 'block';
    document.getElementById('deletePlaybookBtn').style.display = 'none';

    updatePlayButtonState();
}

function showPlaybookEditor() {
    document.getElementById('playbookInfo').style.display = 'block';
    document.getElementById('playbookEventsSection').style.display = 'block';
    document.getElementById('playbookEmpty').style.display = 'none';
    document.getElementById('deletePlaybookBtn').style.display = 'inline-block';
}

function newPlaybook() {
    if (playbackState.isPlaying) {
        alert('播放中无法新建剧本');
        return;
    }

    currentPlaybook = null;
    currentPlaybookEvents = [];

    document.getElementById('playbookSelect').value = '';
    document.getElementById('playbookName').value = '新故障剧本';
    document.getElementById('playbookDesc').value = '';

    showPlaybookEditor();
    renderPlaybookEvents();
    updatePlayButtonState();
}

function renderPlaybookEvents() {
    const list = document.getElementById('playbookEventsList');

    if (currentPlaybookEvents.length === 0) {
        list.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:10px 0;">暂无事件，点击"添加事件"开始编排</p>';
        return;
    }

    const sortedEvents = [...currentPlaybookEvents].sort((a, b) => a.time - b.time);

    let html = '';
    sortedEvents.forEach((event, index) => {
        const link = links.find(l => l.id === event.linkId);
        const linkName = link ? getLinkName(link) : '未知链路';

        html += `
            <div class="playbook-event-item" data-index="${index}">
                <input type="number" class="event-time" value="${event.time.toFixed(1)}" 
                       step="0.1" min="0" onchange="updateEventTime(${index}, this.value)">
                <select class="event-link" onchange="updateEventLink(${index}, this.value)" ${playbackState.isPlaying ? 'disabled' : ''}>
                    ${getLinkSelectOptions(event.linkId)}
                </select>
                <button class="event-action ${event.action === 'break' ? 'break' : 'restore'}" 
                        onclick="toggleEventAction(${index})" ${playbackState.isPlaying ? 'disabled' : ''}>
                    ${event.action === 'break' ? '断开' : '恢复'}
                </button>
                <span class="event-delete" onclick="deletePlaybookEvent(${index})" 
                      ${playbackState.isPlaying ? 'style="pointer-events:none;opacity:0.3;"' : ''}>×</span>
            </div>
        `;
    });

    list.innerHTML = html;
}

function getLinkSelectOptions(selectedId) {
    let options = '<option value="">选择链路</option>';
    links.forEach(link => {
        const name = getLinkName(link);
        options += `<option value="${link.id}" ${link.id === selectedId ? 'selected' : ''}>${name}</option>`;
    });
    return options;
}

function getLinkName(link) {
    const srcDev = devices.find(d => d.id === link.from);
    const dstDev = devices.find(d => d.id === link.to);
    const srcName = srcDev ? srcDev.name : '?';
    const dstName = dstDev ? dstDev.name : '?';
    return `${srcName}-${dstName}`;
}

function addPlaybookEvent() {
    if (playbackState.isPlaying) return;

    if (links.length === 0) {
        alert('请先创建链路');
        return;
    }

    const lastEvent = currentPlaybookEvents[currentPlaybookEvents.length - 1];
    const newTime = lastEvent ? lastEvent.time + 1.0 : 0;

    currentPlaybookEvents.push({
        time: newTime,
        linkId: links[0].id,
        action: 'break'
    });

    renderPlaybookEvents();
}

function updateEventTime(index, value) {
    if (playbackState.isPlaying) return;
    const time = parseFloat(value);
    if (!isNaN(time) && time >= 0) {
        currentPlaybookEvents[index].time = Math.round(time * 10) / 10;
        renderPlaybookEvents();
    }
}

function updateEventLink(index, linkId) {
    if (playbackState.isPlaying) return;
    currentPlaybookEvents[index].linkId = parseInt(linkId);
}

function toggleEventAction(index) {
    if (playbackState.isPlaying) return;
    currentPlaybookEvents[index].action = 
        currentPlaybookEvents[index].action === 'break' ? 'restore' : 'break';
    renderPlaybookEvents();
}

function deletePlaybookEvent(index) {
    if (playbackState.isPlaying) return;
    currentPlaybookEvents.splice(index, 1);
    renderPlaybookEvents();
}

async function savePlaybook() {
    if (playbackState.isPlaying) {
        alert('播放中无法保存');
        return;
    }

    const name = document.getElementById('playbookName').value.trim();
    if (!name) {
        alert('请输入剧本名称');
        return;
    }

    const description = document.getElementById('playbookDesc').value.trim();

    try {
        const result = await apiRequest('/fault-playbooks' + (currentPlaybook ? '/' + currentPlaybook.id : ''), {
            method: currentPlaybook ? 'PUT' : 'POST',
            body: JSON.stringify({
                name,
                description,
                events: currentPlaybookEvents
            })
        });

        if (result.success) {
            addLog(`故障剧本已保存: ${name}`, 'success');
            await loadFaultPlaybooks();

            if (currentPlaybook) {
                document.getElementById('playbookSelect').value = currentPlaybook.id;
            } else {
                document.getElementById('playbookSelect').value = result.data.id;
                currentPlaybook = result.data;
            }
        } else {
            alert('保存失败: ' + (result.error || '未知错误'));
        }
    } catch (err) {
        alert('保存失败: ' + err.message);
    }
}

async function deletePlaybook() {
    if (!currentPlaybook) return;
    if (playbackState.isPlaying) {
        alert('播放中无法删除');
        return;
    }

    if (!confirm('确定要删除这个故障剧本吗？')) return;

    try {
        const result = await apiRequest('/fault-playbooks/' + currentPlaybook.id, {
            method: 'DELETE'
        });

        if (result.success) {
            addLog('故障剧本已删除', 'info');
            await loadFaultPlaybooks();
            clearPlaybookEditor();
        }
    } catch (err) {
        alert('删除失败: ' + err.message);
    }
}

function updatePlayButtonState() {
    const playBtn = document.getElementById('playPlaybookBtn');
    const canPlay = currentPlaybookEvents.length > 0 && !playbackState.isPlaying;
    playBtn.disabled = !canPlay;
    playBtn.style.opacity = canPlay ? '1' : '0.5';
}

function startPlayback() {
    if (!currentPlaybookEvents || currentPlaybookEvents.length === 0) {
        alert('请先添加故障事件');
        return;
    }

    if (playbackState.isPlaying) return;

    playbackState.prePlaybackLinkStates = links.map(link => ({
        id: link.id,
        enabled: link.enabled !== false
    }));

    playbackState.currentPlaybookId = currentPlaybook ? currentPlaybook.id : null;

    const sortedEvents = [...currentPlaybookEvents].sort((a, b) => a.time - b.time);

    playbackState.isPlaying = true;
    playbackState.isPaused = false;
    playbackState.startTime = Date.now();
    playbackState.pausedDuration = 0;
    playbackState.currentEventIndex = 0;
    playbackState.totalEvents = sortedEvents.length;

    resilienceSamples = [];
    
    stopSampling();

    updatePlaybackUI();
    updatePlayButtonState();

    startSampling();

    processPlaybackEvents(sortedEvents);
}

function processPlaybackEvents(sortedEvents) {
    const checkEvents = () => {
        if (!playbackState.isPlaying || playbackState.isPaused) return;

        const elapsed = (Date.now() - playbackState.startTime - playbackState.pausedDuration) / 1000;

        while (playbackState.currentEventIndex < sortedEvents.length &&
               sortedEvents[playbackState.currentEventIndex].time <= elapsed) {
            const event = sortedEvents[playbackState.currentEventIndex];
            executePlaybackEvent(event);
            playbackState.currentEventIndex++;
            updatePlaybackUI();
        }

        updatePlaybackProgress(elapsed);

        if (playbackState.currentEventIndex >= sortedEvents.length) {
            setTimeout(() => {
                finishPlayback('completed');
            }, 500);
            return;
        }

        playbackState.timerId = setTimeout(checkEvents, 50);
    };

    checkEvents();
}

function executePlaybackEvent(event) {
    const link = links.find(l => l.id === event.linkId);
    if (!link) return;

    if (event.action === 'break') {
        if (link.enabled !== false) {
            link.enabled = false;
            faultStats.disabledLinkCount++;
            faultStats.totalFaultCount++;
            handleLinkStateChange(link.id, 'disable_link');
        }
        addLog(`[故障剧本] 断开链路: ${getLinkName(link)}`, 'warning');
    } else if (event.action === 'restore') {
        if (link.enabled === false) {
            link.enabled = true;
            faultStats.disabledLinkCount--;
            handleLinkStateChange(link.id, 'enable_link');
        }
        addLog(`[故障剧本] 恢复链路: ${getLinkName(link)}`, 'success');
    }
}

function updatePlaybackUI() {
    const statusText = document.getElementById('playbackStatusText');
    const statusIndicator = document.getElementById('playbackStatusIndicator');
    const playBtn = document.getElementById('playPlaybookBtn');
    const pauseBtn = document.getElementById('pausePlaybackBtn');
    const resumeBtn = document.getElementById('resumePlaybackBtn');
    const stopBtn = document.getElementById('stopPlaybackBtn');

    if (playbackState.isPlaying && !playbackState.isPaused) {
        statusText.textContent = '播放中';
        statusIndicator.className = 'playback-status-indicator playing';
        playBtn.style.display = 'none';
        pauseBtn.style.display = 'block';
        resumeBtn.style.display = 'none';
        stopBtn.style.display = 'block';
    } else if (playbackState.isPaused) {
        statusText.textContent = '已暂停';
        statusIndicator.className = 'playback-status-indicator paused';
        playBtn.style.display = 'none';
        pauseBtn.style.display = 'none';
        resumeBtn.style.display = 'block';
        stopBtn.style.display = 'block';
    } else {
        statusText.textContent = '未播放';
        statusIndicator.className = 'playback-status-indicator';
        playBtn.style.display = 'block';
        pauseBtn.style.display = 'none';
        resumeBtn.style.display = 'none';
        stopBtn.style.display = 'none';
    }

    const progressText = document.getElementById('playbackEventProgress');
    progressText.textContent = `${playbackState.currentEventIndex}/${playbackState.totalEvents} 事件`;
}

function updatePlaybackProgress(elapsedSeconds) {
    const sortedEvents = [...currentPlaybookEvents].sort((a, b) => a.time - b.time);
    const totalDuration = sortedEvents.length > 0 ? sortedEvents[sortedEvents.length - 1].time : 0;

    const progressFill = document.getElementById('playbackProgressFill');
    const timeText = document.getElementById('playbackTimeProgress');

    const progress = totalDuration > 0 ? Math.min(100, (elapsedSeconds / totalDuration) * 100) : 0;
    progressFill.style.width = progress + '%';
    timeText.textContent = elapsedSeconds.toFixed(1) + 's';
}

function pausePlayback() {
    if (!playbackState.isPlaying || playbackState.isPaused) return;

    playbackState.isPaused = true;
    playbackState.pausedTime = Date.now();

    if (playbackState.timerId) {
        clearTimeout(playbackState.timerId);
        playbackState.timerId = null;
    }

    stopSampling();
    updatePlaybackUI();
}

function resumePlayback() {
    if (!playbackState.isPaused) return;

    const pauseDuration = Date.now() - playbackState.pausedTime;
    playbackState.pausedDuration += pauseDuration;
    playbackState.isPaused = false;

    const sortedEvents = [...currentPlaybookEvents].sort((a, b) => a.time - b.time);

    startSampling();
    processPlaybackEvents(sortedEvents);
    updatePlaybackUI();
}

function stopPlayback() {
    if (!playbackState.isPlaying) return;

    finishPlayback('aborted');
}

function finishPlayback(status) {
    playbackState.isPlaying = false;
    playbackState.isPaused = false;

    if (playbackState.timerId) {
        clearTimeout(playbackState.timerId);
        playbackState.timerId = null;
    }

    stopSampling();

    if (status === 'aborted') {
        restorePrePlaybackState();
        addLog('[故障剧本] 播放已终止，链路已恢复', 'info');
    } else {
        addLog('[故障剧本] 播放完成', 'success');
    }

    updatePlaybackUI();
    updatePlayButtonState();

    generateResilienceReport(status);
}

function restorePrePlaybackState() {
    let changed = false;

    playbackState.prePlaybackLinkStates.forEach(state => {
        const link = links.find(l => l.id === state.id);
        if (link) {
            const oldEnabled = link.enabled !== false;
            const newEnabled = state.enabled;

            if (oldEnabled !== newEnabled) {
                link.enabled = newEnabled;
                changed = true;

                if (newEnabled) {
                    faultStats.disabledLinkCount--;
                } else {
                    faultStats.disabledLinkCount++;
                }
            }
        }
    });

    if (changed) {
        handleLinkStateChange(null, 'restore_all');
        updateFaultStats();
    }
}

function startSampling() {
    if (samplingTimerId) return;

    sampleResilienceState();

    samplingTimerId = setInterval(() => {
        sampleResilienceState();
    }, SAMPLING_INTERVAL);
}

function stopSampling() {
    if (samplingTimerId) {
        clearInterval(samplingTimerId);
        samplingTimerId = null;
    }
}

function sampleResilienceState() {
    const elapsed = playbackState.isPlaying 
        ? (Date.now() - playbackState.startTime - playbackState.pausedDuration) / 1000
        : 0;

    const partitionCount = partitions.length;

    let unreachablePairs = 0;
    if (partitions.length > 1) {
        const totalDevices = devices.length;
        let sumSquares = 0;
        partitions.forEach(p => {
            sumSquares += p.deviceIds.length * p.deviceIds.length;
        });
        unreachablePairs = (totalDevices * totalDevices - sumSquares) / 2;
    }

    let pausedFlowCount = 0;
    trafficFlows.forEach(flow => {
        if (flow.paused) {
            pausedFlowCount++;
        }
    });

    let slaBreachCount = 0;
    if (typeof slaContracts !== 'undefined' && slaContracts) {
        slaContracts.forEach(contract => {
            if (contract.status === 'breached') {
                slaBreachCount++;
            }
        });
    }

    resilienceSamples.push({
        time: Math.round(elapsed * 10) / 10,
        partitionCount,
        unreachablePairs,
        pausedFlowCount,
        slaBreachCount
    });
}

function generateResilienceReport(status) {
    if (resilienceSamples.length === 0) {
        sampleResilienceState();
    }

    const totalDuration = resilienceSamples.length > 0 
        ? resilienceSamples[resilienceSamples.length - 1].time 
        : 0;

    const totalEvents = playbackState.totalEvents;
    const triggeredEvents = playbackState.currentEventIndex;

    let maxPartitionCount = 1;
    let longestDisconnectDuration = 0;
    let totalDisconnectDuration = 0;
    let disconnectionStart = null;

    resilienceSamples.forEach(sample => {
        if (sample.partitionCount > maxPartitionCount) {
            maxPartitionCount = sample.partitionCount;
        }

        if (sample.partitionCount > 1) {
            if (disconnectionStart === null) {
                disconnectionStart = sample.time;
            }
        } else {
            if (disconnectionStart !== null) {
                const duration = sample.time - disconnectionStart;
                totalDisconnectDuration += duration;
                if (duration > longestDisconnectDuration) {
                    longestDisconnectDuration = duration;
                }
                disconnectionStart = null;
            }
        }
    });

    if (disconnectionStart !== null) {
        const duration = totalDuration - disconnectionStart;
        totalDisconnectDuration += duration;
        if (duration > longestDisconnectDuration) {
            longestDisconnectDuration = duration;
        }
    }

    const linkRanking = calculateLinkResilienceRanking();

    const recoverySpeeds = calculateRecoverySpeeds();

    const sortedSamples = [...resilienceSamples].sort((a, b) => a.time - b.time);

    currentResilienceReport = {
        playbookId: currentPlaybook ? currentPlaybook.id : null,
        playbookName: currentPlaybook ? currentPlaybook.name : '未命名剧本',
        status,
        totalDuration,
        totalEvents,
        triggeredEvents,
        maxPartitionCount,
        longestDisconnectDuration,
        totalDisconnectDuration,
        linkResilienceRanking: linkRanking,
        timelineSamples: sortedSamples,
        recoverySpeeds,
        slaBreachCount: sortedSamples.length > 0 ? sortedSamples[sortedSamples.length - 1].slaBreachCount : 0,
        pausedFlowCount: sortedSamples.length > 0 ? sortedSamples[sortedSamples.length - 1].pausedFlowCount : 0,
        unreachablePairCount: sortedSamples.length > 0 ? sortedSamples[sortedSamples.length - 1].unreachablePairs : 0,
        timestamp: Date.now()
    };

    renderResilienceReport();
    saveResilienceReportToBackend(currentResilienceReport);
}

function calculateLinkResilienceRanking() {
    const linkImpacts = new Map();

    const breakEvents = [...currentPlaybookEvents]
        .filter(e => e.action === 'break')
        .sort((a, b) => a.time - b.time);

    if (breakEvents.length === 0) return [];

    function findSampleBeforeOrAt(time) {
        let result = null;
        for (const s of resilienceSamples) {
            if (s.time <= time) {
                result = s;
            } else {
                break;
            }
        }
        return result;
    }

    function findSampleAfter(time) {
        for (const s of resilienceSamples) {
            if (s.time > time) {
                return s;
            }
        }
        return null;
    }

    const groupedEvents = new Map();
    breakEvents.forEach(event => {
        const afterSample = findSampleAfter(event.time);
        const groupKey = afterSample ? afterSample.time : 'end';
        if (!groupedEvents.has(groupKey)) {
            groupedEvents.set(groupKey, {
                events: [],
                preSample: findSampleBeforeOrAt(event.time),
                postSample: afterSample
            });
        }
        groupedEvents.get(groupKey).events.push(event);
    });

    groupedEvents.forEach(group => {
        const { events: groupEvents, preSample, postSample } = group;
        if (!postSample) return;

        const prePartitions = preSample ? preSample.partitionCount : 1;
        const prePausedFlows = preSample ? preSample.pausedFlowCount : 0;
        const postPartitions = postSample.partitionCount;
        const postPausedFlows = postSample.pausedFlowCount;

        const totalPartitionIncrease = Math.max(0, postPartitions - prePartitions);
        const totalPauseIncrease = Math.max(0, postPausedFlows - prePausedFlows);

        const eventCount = groupEvents.length;
        if (eventCount === 0) return;

        const avgPartitionIncrease = totalPartitionIncrease / eventCount;
        const avgPauseIncrease = totalPauseIncrease / eventCount;

        groupEvents.forEach(event => {
            const link = links.find(l => l.id === event.linkId);
            if (!link) return;

            const linkName = getLinkName(link);
            if (!linkImpacts.has(event.linkId)) {
                linkImpacts.set(event.linkId, {
                    linkId: event.linkId,
                    linkName,
                    totalPartitionIncrease: 0,
                    maxPartitionIncrease: 0,
                    totalPauseIncrease: 0,
                    maxPauseIncrease: 0,
                    breakCount: 0
                });
            }

            const impact = linkImpacts.get(event.linkId);
            impact.totalPartitionIncrease += avgPartitionIncrease;
            impact.maxPartitionIncrease = Math.max(impact.maxPartitionIncrease, avgPartitionIncrease);
            impact.totalPauseIncrease += avgPauseIncrease;
            impact.maxPauseIncrease = Math.max(impact.maxPauseIncrease, avgPauseIncrease);
            impact.breakCount++;
        });
    });

    const ranking = Array.from(linkImpacts.values()).sort((a, b) => {
        const scoreA = a.totalPartitionIncrease * 10 + a.totalPauseIncrease;
        const scoreB = b.totalPartitionIncrease * 10 + b.totalPauseIncrease;
        return scoreB - scoreA;
    });

    return ranking;
}

function calculateRecoverySpeeds() {
    const recoveryEvents = [...currentPlaybookEvents]
        .filter(e => e.action === 'restore')
        .sort((a, b) => a.time - b.time);

    const speeds = [];

    recoveryEvents.forEach(event => {
        const link = links.find(l => l.id === event.linkId);
        if (!link) return;

        const recoveryStartTime = event.time;

        let fullyRecoveredTime = null;

        for (let i = 0; i < resilienceSamples.length; i++) {
            const sample = resilienceSamples[i];

            if (sample.time >= recoveryStartTime) {
                if (sample.partitionCount <= 1 && sample.pausedFlowCount === 0) {
                    fullyRecoveredTime = sample.time;
                    break;
                }
            }
        }

        if (fullyRecoveredTime !== null) {
            speeds.push({
                linkId: event.linkId,
                linkName: getLinkName(link),
                recoveryTime: Math.round((fullyRecoveredTime - recoveryStartTime) * 100) / 100
            });
        }
    });

    return speeds.sort((a, b) => a.recoveryTime - b.recoveryTime);
}

function renderResilienceReport() {
    if (!currentResilienceReport) return;

    document.getElementById('resilienceReportEmpty').style.display = 'none';
    document.getElementById('resilienceReportContainer').style.display = 'block';

    document.getElementById('resilienceReportTitle').textContent = 
        `${currentResilienceReport.playbookName} - 韧性评估报告`;

    renderResilienceOverview();
    renderLinkRanking();
    renderResilienceTimeline();
    renderRecoverySpeeds();
}

function renderResilienceOverview() {
    const report = currentResilienceReport;
    const container = document.getElementById('resilienceOverviewStats');

    container.innerHTML = `
        <div class="report-stat-item">
            <div class="stat-value">${report.totalDuration.toFixed(1)}s</div>
            <div class="stat-label">总时长</div>
        </div>
        <div class="report-stat-item">
            <div class="stat-value">${report.triggeredEvents}/${report.totalEvents}</div>
            <div class="stat-label">故障事件</div>
        </div>
        <div class="report-stat-item">
            <div class="stat-value" style="color: #f5222d;">${report.maxPartitionCount}</div>
            <div class="stat-label">最大分区数</div>
        </div>
        <div class="report-stat-item">
            <div class="stat-value">${report.longestDisconnectDuration.toFixed(1)}s</div>
            <div class="stat-label">最长不连通</div>
        </div>
    `;
}

function renderLinkRanking() {
    const ranking = currentResilienceReport.linkResilienceRanking;
    const container = document.getElementById('resilienceLinkRanking');

    if (ranking.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size:11px;color:#999;text-align:center;padding:10px 0;">无数据</p>';
        return;
    }

    let html = '';
    ranking.forEach((item, index) => {
        html += `
            <div class="report-link-item">
                <div class="report-link-rank">${index + 1}</div>
                <div class="report-link-name">${item.linkName}</div>
                <div class="report-link-stats">
                    <div class="report-link-stat">
                        <div class="stat-num">${item.totalPartitionIncrease}</div>
                        <div>分区增加</div>
                    </div>
                    <div class="report-link-stat">
                        <div class="stat-num">${item.totalPauseIncrease}</div>
                        <div>流量中断</div>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderResilienceTimeline() {
    const samples = currentResilienceReport.timelineSamples;
    const events = [...currentPlaybookEvents].sort((a, b) => a.time - b.time);
    const container = document.getElementById('resilienceTimeline');

    if (samples.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size:11px;color:#999;text-align:center;padding:10px 0;">无数据</p>';
        return;
    }

    let html = '<div class="resilience-timeline">';

    let eventIndex = 0;

    for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];

        while (eventIndex < events.length && events[eventIndex].time <= sample.time) {
            const event = events[eventIndex];
            const link = links.find(l => l.id === event.linkId);
            const linkName = link ? getLinkName(link) : '未知';

            html += `
                <div class="timeline-item event">
                    <div class="timeline-time">${event.time.toFixed(1)}s</div>
                    <div class="timeline-content">
                        <span class="event-type ${event.action}">${event.action === 'break' ? '断开' : '恢复'}</span>
                        ${linkName}
                    </div>
                </div>
            `;
            eventIndex++;
        }

        if (i % 5 === 0 || i === samples.length - 1) {
            html += `
                <div class="timeline-item">
                    <div class="timeline-time">${sample.time.toFixed(1)}s</div>
                    <div class="timeline-content">
                        采样点
                    </div>
                    <div class="timeline-stats">
                        <span>分区: ${sample.partitionCount}</span>
                        <span>不可达对: ${sample.unreachablePairs}</span>
                        <span>暂停流: ${sample.pausedFlowCount}</span>
                    </div>
                </div>
            `;
        }
    }

    html += '</div>';
    container.innerHTML = html;
}

function renderRecoverySpeeds() {
    const speeds = currentResilienceReport.recoverySpeeds;
    const container = document.getElementById('resilienceRecoverySpeeds');

    if (speeds.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size:11px;color:#999;text-align:center;padding:10px 0;">无恢复事件</p>';
        return;
    }

    let html = '';
    speeds.forEach(item => {
        html += `
            <div class="recovery-item">
                <div class="recovery-link-name">${item.linkName}</div>
                <div class="recovery-time">${item.recoveryTime.toFixed(2)}<span class="unit">s</span></div>
            </div>
        `;
    });

    container.innerHTML = html;
}

async function saveResilienceReportToBackend(report) {
    try {
        await apiRequest('/resilience-reports', {
            method: 'POST',
            body: JSON.stringify(report)
        });
    } catch (err) {
        console.error('保存报告失败:', err);
    }
}

async function loadResilienceReportHistory() {
    try {
        const result = await apiRequest('/resilience-reports');
        if (result.success) {
            renderResilienceReportHistory(result.data);
        }
    } catch (err) {
        console.error('加载历史报告失败:', err);
    }
}

function renderResilienceReportHistory(reports) {
    const container = document.getElementById('resilienceReportHistoryList');

    if (reports.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:15px;">暂无历史报告</p>';
        return;
    }

    let html = '';
    reports.forEach(report => {
        const date = new Date(report.timestamp);
        const dateStr = date.toLocaleString('zh-CN');

        html += `
            <div class="history-item" onclick="viewResilienceReport(${report.id})">
                <div class="history-item-name">${report.playbookName}</div>
                <div class="history-item-meta">
                    <span class="history-item-status ${report.status}">
                        ${report.status === 'completed' ? '已完成' : '已终止'}
                    </span>
                    <span>${dateStr}</span>
                </div>
                <div class="history-item-meta" style="margin-top:4px;">
                    <span>最大分区: ${report.maxPartitionCount}</span>
                    <span>${report.totalDuration.toFixed(1)}s</span>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

async function viewResilienceReport(reportId) {
    try {
        const result = await apiRequest('/resilience-reports/' + reportId);
        if (result.success && result.data) {
            currentResilienceReport = result.data;

            if (result.data.playbookId) {
                const playbookResult = await apiRequest('/fault-playbooks/' + result.data.playbookId);
                if (playbookResult.success && playbookResult.data) {
                    currentPlaybookEvents = playbookResult.data.events || [];
                }
            }

            switchPlaybookTab('editor');
            renderResilienceReport();
        }
    } catch (err) {
        alert('加载报告详情失败: ' + err.message);
    }
}

function exportResilienceReport() {
    if (!currentResilienceReport) return;

    const dataStr = JSON.stringify(currentResilienceReport, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });

    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `resilience-report-${currentResilienceReport.playbookName}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function initFaultPlaybookModule() {
    document.getElementById('newPlaybookBtn').addEventListener('click', newPlaybook);
    document.getElementById('deletePlaybookBtn').addEventListener('click', deletePlaybook);
    document.getElementById('addEventBtn').addEventListener('click', addPlaybookEvent);
    document.getElementById('savePlaybookBtn').addEventListener('click', savePlaybook);
    document.getElementById('playbookSelect').addEventListener('change', onPlaybookSelectChange);

    document.getElementById('playPlaybookBtn').addEventListener('click', startPlayback);
    document.getElementById('pausePlaybackBtn').addEventListener('click', pausePlayback);
    document.getElementById('resumePlaybackBtn').addEventListener('click', resumePlayback);
    document.getElementById('stopPlaybackBtn').addEventListener('click', stopPlayback);

    document.getElementById('exportResilienceReportBtn').addEventListener('click', exportResilienceReport);
    document.getElementById('refreshReportHistoryBtn').addEventListener('click', loadResilienceReportHistory);

    document.querySelectorAll('.playbook-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            switchPlaybookTab(tab.dataset.playbookTab);
        });
    });

    loadFaultPlaybooks();
}

window.newPlaybook = newPlaybook;
window.deletePlaybook = deletePlaybook;
window.addPlaybookEvent = addPlaybookEvent;
window.updateEventTime = updateEventTime;
window.updateEventLink = updateEventLink;
window.toggleEventAction = toggleEventAction;
window.deletePlaybookEvent = deletePlaybookEvent;
window.viewResilienceReport = viewResilienceReport;

init();

initMigrationModule();

initFaultPlaybookModule();

let capacityExpansionPlans = [];
let capacityPlanIdCounter = 1;
let lastCapacitySimResult = null;

function initCapacityPlanningModule() {
    document.getElementById('openCapacityModalBtn').addEventListener('click', openCapacityModal);
    document.getElementById('closeCapacityModal').addEventListener('click', closeCapacityModal);

    document.querySelectorAll('.capacity-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            switchCapacityTab(tab.dataset.capacityTab);
        });
    });

    const multiplierInput = document.getElementById('capacityMultiplier');
    const multiplierDisplay = document.getElementById('capacityMultiplierValue');
    multiplierInput.addEventListener('input', () => {
        multiplierDisplay.textContent = parseFloat(multiplierInput.value).toFixed(1) + 'x';
    });

    document.getElementById('runCapacitySimBtn').addEventListener('click', runCapacitySimulation);
    document.getElementById('saveCapacityPlanBtn').addEventListener('click', saveCapacityPlan);
    document.getElementById('runCapacityCompareBtn').addEventListener('click', runCapacityCompare);
    document.getElementById('refreshCapacityHistoryBtn').addEventListener('click', loadCapacityHistory);

    loadCapacityExpansionPlansFromStorage();
}

function openCapacityModal() {
    document.getElementById('capacityModal').style.display = 'block';
    refreshCapacityPlanSelects();
    refreshCapacityPlanLinkList();
    refreshCapacityPlanSavedList();
    loadCapacityHistory();
}

function closeCapacityModal() {
    document.getElementById('capacityModal').style.display = 'none';
}

function switchCapacityTab(tabName) {
    document.querySelectorAll('.capacity-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.capacityTab === tabName);
    });
    document.querySelectorAll('.capacity-tab-content').forEach(content => {
        content.style.display = 'none';
    });
    const target = document.getElementById('capacity-tab-' + tabName);
    if (target) target.style.display = 'block';

    if (tabName === 'expansion') {
        refreshCapacityPlanLinkList();
        refreshCapacityPlanSavedList();
    }
    if (tabName === 'compare') {
        refreshCapacityPlanSelects();
    }
}

function calculateSimulatedLinkLoads(multiplier, planOverrides) {
    const overrides = planOverrides || {};
    const result = new Map();

    links.forEach(link => {
        if (!link.enabled) return;

        let totalRate = 0;
        trafficFlows.forEach(flow => {
            if (flow.path && flow.path.segments && flow.path.segments.some(seg =>
                (seg.from === link.from && seg.to === link.to) ||
                (seg.from === link.to && seg.to === link.from)
            )) {
                totalRate += (flow.actualRate || flow.rate) * multiplier;
            }
        });

        const effectiveBandwidth = overrides[link.id] !== undefined ? overrides[link.id] : link.bandwidth;
        const loadRate = totalRate / (effectiveBandwidth * 1000000);

        result.set(link.id, {
            linkId: link.id,
            linkName: getLinkDisplayName(link.id),
            currentBandwidth: link.bandwidth,
            effectiveBandwidth: effectiveBandwidth,
            loadRate: loadRate,
            usedMbps: totalRate,
            from: link.from,
            to: link.to
        });
    });

    return result;
}

function calculateSimulatedSlaViolations(multiplier, planOverrides) {
    const overrides = planOverrides || {};
    let violationCount = 0;
    const violatingContracts = [];

    slaContracts.forEach(contract => {
        if (!contract.monitoring) return;

        const path = getPath(contract.srcDeviceId, contract.dstDeviceId);
        if (!path || !path.segments || path.segments.length === 0) {
            violationCount++;
            violatingContracts.push({ name: contract.name, reason: '不可达' });
            return;
        }

        let latency = 0;
        path.segments.forEach(seg => { latency += seg.link.delay; });

        let passThroughProduct = 1;
        path.segments.forEach(seg => {
            const congestionState = congestionStates.get(seg.link.id);
            const simLoad = (getLinkLoad(seg.link.id)) * multiplier;
            if ((congestionState && congestionState.packetLossActive) || simLoad > 0.8) {
                passThroughProduct *= (1 - 0.2);
            }
        });
        const lossRate = (1 - passThroughProduct) * 100;

        let availableBandwidth = Infinity;
        path.segments.forEach(seg => {
            const link = seg.link;
            const effectiveBandwidth = overrides[link.id] !== undefined ? overrides[link.id] : link.bandwidth;
            const currentLoad = getLinkLoad(link.id);
            const simLoadRate = currentLoad * multiplier;
            const usedBw = simLoadRate * effectiveBandwidth;
            const remaining = effectiveBandwidth - usedBw;
            if (remaining < availableBandwidth) {
                availableBandwidth = remaining;
            }
        });

        const isViolating = latency > contract.maxLatency ||
            lossRate > contract.maxLossRate ||
            availableBandwidth < contract.minBandwidth;

        if (isViolating) {
            violationCount++;
            const reasons = [];
            if (latency > contract.maxLatency) reasons.push('延迟');
            if (lossRate > contract.maxLossRate) reasons.push('丢包');
            if (availableBandwidth < contract.minBandwidth) reasons.push('带宽');
            violatingContracts.push({ name: contract.name, reasons });
        }
    });

    return { violationCount, violatingContracts };
}

function getCurrentSlaViolationCount() {
    return slaContracts.filter(c => c.isViolating).length;
}

function findBottleneckLink(linkLoadMap) {
    const overloaded = [];
    linkLoadMap.forEach(info => {
        if (info.loadRate > 1.0) overloaded.push(info);
    });

    if (overloaded.length === 0) return null;
    if (overloaded.length === 1) return overloaded[0];

    let bestLink = null;
    let bestResolved = -1;

    overloaded.forEach(candidate => {
        const neededBw = candidate.usedMbps / 0.8 / 1000000;
        const overrides = {};
        overrides[candidate.linkId] = neededBw;

        const simLoads = calculateSimulatedLinkLoads(
            parseFloat(document.getElementById('capacityMultiplier').value),
            overrides
        );

        let resolvedCount = 0;
        overloaded.forEach(overloadedInfo => {
            const simInfo = simLoads.get(overloadedInfo.linkId);
            if (simInfo && simInfo.loadRate <= 0.8) resolvedCount++;
        });

        if (resolvedCount > bestResolved) {
            bestResolved = resolvedCount;
            bestLink = candidate;
        }
    });

    if (!bestLink) bestLink = overloaded[0];
    return bestLink;
}

function calculateRecommendedBandwidths(linkLoadMap) {
    const recommendations = [];
    linkLoadMap.forEach(info => {
        if (info.loadRate > 1.0) {
            const recommendedBw = Math.ceil((info.usedMbps / 0.8 / 1000000) * 10) / 10;
            recommendations.push({
                linkId: info.linkId,
                linkName: info.linkName,
                currentBandwidth: info.currentBandwidth,
                recommendedBandwidth: Math.max(recommendedBw, info.currentBandwidth + 0.1),
                simulatedLoadRate: info.loadRate,
                usedMbps: info.usedMbps
            });
        }
    });
    recommendations.sort((a, b) => b.simulatedLoadRate - a.simulatedLoadRate);
    return recommendations;
}

function runCapacitySimulation() {
    const multiplier = parseFloat(document.getElementById('capacityMultiplier').value);
    const planId = document.getElementById('capacityPlanSelect').value;
    let planOverrides = {};
    let planName = null;

    if (planId) {
        const plan = capacityExpansionPlans.find(p => p.id == planId);
        if (plan) {
            planName = plan.name;
            plan.upgrades.forEach(u => {
                planOverrides[u.linkId] = u.newBandwidth;
            });
        }
    }

    const linkLoadMap = calculateSimulatedLinkLoads(multiplier, planOverrides);
    const currentSlaViolations = getCurrentSlaViolationCount();
    const simSlaResult = calculateSimulatedSlaViolations(multiplier, planOverrides);
    const bottleneck = findBottleneckLink(linkLoadMap);
    const recommendations = calculateRecommendedBandwidths(linkLoadMap);

    let overloadCount = 0;
    let warningCount = 0;
    const linkResults = [];
    linkLoadMap.forEach(info => {
        if (info.loadRate > 1.0) overloadCount++;
        else if (info.loadRate > 0.8) warningCount++;
        linkResults.push(info);
    });
    linkResults.sort((a, b) => b.loadRate - a.loadRate);

    lastCapacitySimResult = {
        multiplier,
        planName,
        planOverrides,
        overloadCount,
        warningCount,
        linkResults,
        currentSlaViolations,
        simulatedSlaViolations: simSlaResult.violationCount,
        violatingContracts: simSlaResult.violatingContracts,
        bottleneck,
        recommendations
    };

    renderCapacitySimResults(lastCapacitySimResult);
    saveCapacitySimulationToBackend(lastCapacitySimResult);
}

function renderCapacitySimResults(result) {
    document.getElementById('capacitySimResults').style.display = 'block';

    const summaryEl = document.getElementById('capacitySimSummary');
    const overloadClass = result.overloadCount > 0 ? 'danger' : 'safe';
    const warningClass = result.warningCount > 0 ? 'warning' : 'safe';
    const slaClass = result.simulatedSlaViolations > result.currentSlaViolations ? 'danger' : 'safe';

    summaryEl.innerHTML = `
        <div class="capacity-summary-item">
            <span class="capacity-summary-value ${overloadClass}">${result.overloadCount}</span>
            <span class="capacity-summary-label">超载链路</span>
        </div>
        <div class="capacity-summary-item">
            <span class="capacity-summary-value ${warningClass}">${result.warningCount}</span>
            <span class="capacity-summary-label">预警链路(>80%)</span>
        </div>
        <div class="capacity-summary-item">
            <span class="capacity-summary-value ${slaClass}">${result.simulatedSlaViolations}</span>
            <span class="capacity-summary-label">SLA违约(模拟)</span>
        </div>
        <div class="capacity-summary-item">
            <span class="capacity-summary-value info">${result.multiplier.toFixed(1)}x</span>
            <span class="capacity-summary-label">增长倍数</span>
        </div>
    `;

    const linkListEl = document.getElementById('capacityLinkList');
    let linkHtml = '';
    result.linkResults.forEach(info => {
        let itemClass = '';
        let barColor = '#52c41a';
        if (info.loadRate > 1.0) {
            itemClass = 'overloaded';
            barColor = '#ff4d4f';
        } else if (info.loadRate > 0.8) {
            itemClass = 'warning';
            barColor = '#faad14';
        }
        const barWidth = Math.min(info.loadRate * 100, 100);
        const pctDisplay = (info.loadRate * 100).toFixed(1) + '%';
        const bwDisplay = info.effectiveBandwidth + 'Mbps';
        const upgradeMark = info.effectiveBandwidth > info.currentBandwidth ? ' ⬆' : '';

        linkHtml += `
            <div class="capacity-link-item ${itemClass}">
                <span class="capacity-link-name">${escapeHtml(info.linkName)}</span>
                <span class="capacity-link-bar-container">
                    <span class="capacity-link-bar-fill" style="width:${barWidth}%;background:${barColor};"></span>
                </span>
                <span class="capacity-link-pct" style="color:${barColor};">${pctDisplay}</span>
                <span class="capacity-link-bw">${bwDisplay}${upgradeMark}</span>
            </div>
        `;
    });
    linkListEl.innerHTML = linkHtml || '<p style="font-size:12px;color:#999;text-align:center;padding:10px;">无活跃链路</p>';

    const slaCompareEl = document.getElementById('capacitySlaCompare');
    const currentVioClass = result.currentSlaViolations > 0 ? 'color:#fa8c16;' : 'color:#52c41a;';
    const simVioClass = result.simulatedSlaViolations > 0 ? 'color:#ff4d4f;' : 'color:#52c41a;';
    slaCompareEl.innerHTML = `
        <div class="capacity-sla-compare">
            <div class="capacity-sla-item current">
                <div class="capacity-sla-label">当前实际违约</div>
                <div class="capacity-sla-value" style="${currentVioClass}">${result.currentSlaViolations}</div>
            </div>
            <div class="capacity-sla-item simulated">
                <div class="capacity-sla-label">模拟后违约</div>
                <div class="capacity-sla-value" style="${simVioClass}">${result.simulatedSlaViolations}</div>
            </div>
        </div>
    `;

    const bottleneckSection = document.getElementById('capacityBottleneckSection');
    const bottleneckEl = document.getElementById('capacityBottleneck');
    if (result.bottleneck) {
        bottleneckSection.style.display = 'block';
        bottleneckEl.innerHTML = `
            <div class="capacity-bottleneck-box">
                <div class="capacity-bottleneck-title">瓶颈链路: ${escapeHtml(result.bottleneck.linkName)}</div>
                <div class="capacity-bottleneck-desc">
                    负载率 ${(result.bottleneck.loadRate * 100).toFixed(1)}%，当前带宽 ${result.bottleneck.currentBandwidth}Mbps。
                    升级此链路可使最多超载链路降至安全水位。
                </div>
            </div>
        `;
    } else {
        bottleneckSection.style.display = 'none';
    }

    const recommendedSection = document.getElementById('capacityRecommendedSection');
    const recommendedEl = document.getElementById('capacityRecommended');
    if (result.recommendations.length > 0) {
        recommendedSection.style.display = 'block';
        let tableHtml = `
            <table class="capacity-recommended-table">
                <tr><th>链路</th><th>当前带宽</th><th>模拟负载</th><th>建议带宽</th><th>带宽增量</th></tr>
        `;
        result.recommendations.forEach(rec => {
            const increment = (rec.recommendedBandwidth - rec.currentBandwidth).toFixed(1);
            tableHtml += `
                <tr>
                    <td>${escapeHtml(rec.linkName)}</td>
                    <td>${rec.currentBandwidth}Mbps</td>
                    <td style="color:#ff4d4f;">${(rec.simulatedLoadRate * 100).toFixed(1)}%</td>
                    <td style="color:#1890ff;font-weight:500;">${rec.recommendedBandwidth}Mbps</td>
                    <td>+${increment}Mbps</td>
                </tr>
            `;
        });
        tableHtml += '</table>';
        recommendedEl.innerHTML = tableHtml;
    } else {
        recommendedSection.style.display = 'none';
    }
}

function refreshCapacityPlanLinkList() {
    const container = document.getElementById('capacityPlanLinkList');
    if (links.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:10px 0;">暂无链路</p>';
        return;
    }

    const activeLinks = links.filter(l => l.enabled);
    if (activeLinks.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:10px 0;">暂无活跃链路</p>';
        return;
    }

    let html = '';
    activeLinks.forEach(link => {
        const load = getLinkLoad(link.id);
        const loadPct = (load * 100).toFixed(1);
        html += `
            <div class="capacity-plan-link-item" data-link-id="${link.id}">
                <span class="capacity-plan-link-name">${escapeHtml(getLinkDisplayName(link.id))}</span>
                <span class="capacity-plan-link-current">当前: ${link.bandwidth}Mbps (${loadPct}%)</span>
                <input type="number" class="capacity-plan-link-input" data-link-id="${link.id}"
                    min="${link.bandwidth + 0.1}" step="0.1" placeholder="目标带宽">
                <span style="font-size:10px;color:#999;">Mbps</span>
            </div>
        `;
    });
    container.innerHTML = html;
}

function saveCapacityPlan() {
    if (capacityExpansionPlans.length >= 5) {
        alert('最多保存5个扩容方案');
        return;
    }

    const name = document.getElementById('capacityPlanName').value.trim();
    if (!name) {
        alert('请输入方案名称');
        return;
    }

    const upgrades = [];
    const inputs = document.querySelectorAll('#capacityPlanLinkList .capacity-plan-link-input');
    inputs.forEach(input => {
        const linkId = parseInt(input.dataset.linkId);
        const newBw = parseFloat(input.value);
        const link = links.find(l => l.id === linkId);
        if (link && !isNaN(newBw) && newBw > link.bandwidth) {
            upgrades.push({
                linkId: linkId,
                linkName: getLinkDisplayName(linkId),
                currentBandwidth: link.bandwidth,
                newBandwidth: newBw
            });
        }
    });

    if (upgrades.length === 0) {
        alert('请至少为一条链路设置大于当前带宽的目标带宽');
        return;
    }

    const plan = {
        id: capacityPlanIdCounter++,
        name: name,
        upgrades: upgrades,
        totalInvestment: upgrades.reduce((sum, u) => sum + (u.newBandwidth - u.currentBandwidth), 0),
        createdAt: Date.now()
    };

    capacityExpansionPlans.push(plan);
    document.getElementById('capacityPlanName').value = '';
    document.querySelectorAll('#capacityPlanLinkList .capacity-plan-link-input').forEach(input => {
        input.value = '';
    });

    saveCapacityExpansionPlansToStorage();
    refreshCapacityPlanSavedList();
    refreshCapacityPlanSelects();
    addLog(`扩容方案已保存: ${name}`, 'success');
}

function deleteCapacityPlan(planId) {
    capacityExpansionPlans = capacityExpansionPlans.filter(p => p.id !== planId);
    saveCapacityExpansionPlansToStorage();
    refreshCapacityPlanSavedList();
    refreshCapacityPlanSelects();
}

function loadCapacityPlanToSimulate(planId) {
    const plan = capacityExpansionPlans.find(p => p.id === planId);
    if (!plan) return;
    document.getElementById('capacityPlanSelect').value = planId;
    switchCapacityTab('simulate');
}

function refreshCapacityPlanSavedList() {
    const container = document.getElementById('capacityPlanSavedList');
    const countEl = document.getElementById('capacityPlanCount');
    countEl.textContent = capacityExpansionPlans.length;

    if (capacityExpansionPlans.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:10px 0;">暂无方案</p>';
        return;
    }

    let html = '';
    capacityExpansionPlans.forEach(plan => {
        const upgradeDesc = plan.upgrades.map(u =>
            `${u.linkName}: ${u.currentBandwidth}→${u.newBandwidth}Mbps`
        ).join('; ');
        html += `
            <div class="capacity-plan-saved-item">
                <div class="capacity-plan-saved-header">
                    <span class="capacity-plan-saved-name">${escapeHtml(plan.name)}</span>
                    <div class="capacity-plan-saved-actions">
                        <button class="btn btn-small" onclick="loadCapacityPlanToSimulate(${plan.id})">应用</button>
                        <button class="btn btn-small" style="color:#ff4d4f;" onclick="deleteCapacityPlan(${plan.id})">删除</button>
                    </div>
                </div>
                <div class="capacity-plan-saved-meta">
                    升级${plan.upgrades.length}条链路 | 总投资: ${plan.totalInvestment.toFixed(1)}Mbps增量 | ${upgradeDesc}
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function refreshCapacityPlanSelects() {
    const selects = ['capacityPlanSelect', 'capacityComparePlan1', 'capacityComparePlan2'];
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (!select) return;
        const currentValue = select.value;
        const isSimSelect = selectId === 'capacityPlanSelect';
        select.innerHTML = isSimSelect
            ? '<option value="">无（仅增长模拟）</option>'
            : '<option value="">选择方案</option>';
        capacityExpansionPlans.forEach(plan => {
            const option = document.createElement('option');
            option.value = plan.id;
            option.textContent = plan.name;
            select.appendChild(option);
        });
        if (currentValue && capacityExpansionPlans.find(p => p.id == currentValue)) {
            select.value = currentValue;
        }
    });
}

function runCapacityCompare() {
    const plan1Id = document.getElementById('capacityComparePlan1').value;
    const plan2Id = document.getElementById('capacityComparePlan2').value;
    const multiplier = parseFloat(document.getElementById('capacityCompareMultiplier').value);

    if (!plan1Id || !plan2Id) {
        alert('请选择两个方案进行对比');
        return;
    }
    if (plan1Id === plan2Id) {
        alert('请选择不同的方案');
        return;
    }
    if (isNaN(multiplier) || multiplier < 0.5 || multiplier > 10) {
        alert('增长倍数范围为0.5-10');
        return;
    }

    const plan1 = capacityExpansionPlans.find(p => p.id == plan1Id);
    const plan2 = capacityExpansionPlans.find(p => p.id == plan2Id);
    if (!plan1 || !plan2) {
        alert('方案不存在');
        return;
    }

    let overrides1 = {};
    plan1.upgrades.forEach(u => { overrides1[u.linkId] = u.newBandwidth; });
    let overrides2 = {};
    plan2.upgrades.forEach(u => { overrides2[u.linkId] = u.newBandwidth; });

    const loads1 = calculateSimulatedLinkLoads(multiplier, overrides1);
    const loads2 = calculateSimulatedLinkLoads(multiplier, overrides2);
    const sla1 = calculateSimulatedSlaViolations(multiplier, overrides1);
    const sla2 = calculateSimulatedSlaViolations(multiplier, overrides2);

    let overload1 = 0, overload2 = 0;
    loads1.forEach(info => { if (info.loadRate > 1.0) overload1++; });
    loads2.forEach(info => { if (info.loadRate > 1.0) overload2++; });

    const investment1 = plan1.upgrades.reduce((s, u) => s + (u.newBandwidth - u.currentBandwidth), 0);
    const investment2 = plan2.upgrades.reduce((s, u) => s + (u.newBandwidth - u.currentBandwidth), 0);

    const container = document.getElementById('capacityCompareResults');
    container.style.display = 'block';

    const o1Class = overload1 === 0 ? 'good' : 'bad';
    const o2Class = overload2 === 0 ? 'good' : 'bad';
    const s1Class = sla1.violationCount === 0 ? 'good' : 'bad';
    const s2Class = sla2.violationCount === 0 ? 'good' : 'bad';

    container.innerHTML = `
        <table>
            <tr>
                <th>指标</th>
                <th>方案A: ${escapeHtml(plan1.name)}</th>
                <th>方案B: ${escapeHtml(plan2.name)}</th>
            </tr>
            <tr>
                <td>超载链路数</td>
                <td class="${o1Class}">${overload1}</td>
                <td class="${o2Class}">${overload2}</td>
            </tr>
            <tr>
                <td>SLA违约数</td>
                <td class="${s1Class}">${sla1.violationCount}</td>
                <td class="${s2Class}">${sla2.violationCount}</td>
            </tr>
            <tr>
                <td>总投资(Mbps增量)</td>
                <td>${investment1.toFixed(1)}</td>
                <td>${investment2.toFixed(1)}</td>
            </tr>
            <tr>
                <td>升级链路数</td>
                <td>${plan1.upgrades.length}</td>
                <td>${plan2.upgrades.length}</td>
            </tr>
            <tr>
                <td>性价比(违约数/投资)</td>
                <td>${investment1 > 0 ? (sla1.violationCount / investment1).toFixed(3) : 'N/A'}</td>
                <td>${investment2 > 0 ? (sla2.violationCount / investment2).toFixed(3) : 'N/A'}</td>
            </tr>
        </table>
    `;
}

async function saveCapacitySimulationToBackend(result) {
    try {
        const overloadedLinks = result.linkResults
            .filter(l => l.loadRate > 1.0)
            .map(l => ({ linkId: l.linkId, name: l.linkName, loadRate: (l.loadRate * 100).toFixed(1) + '%' }));

        const warningLinks = result.linkResults
            .filter(l => l.loadRate > 0.8 && l.loadRate <= 1.0)
            .map(l => ({ linkId: l.linkId, name: l.linkName, loadRate: (l.loadRate * 100).toFixed(1) + '%' }));

        const recommendedBandwidths = result.recommendations.map(r => ({
            linkId: r.linkId,
            name: r.linkName,
            currentBandwidth: r.currentBandwidth,
            recommendedBandwidth: r.recommendedBandwidth
        }));

        await apiRequest('/api/capacity-simulations', {
            method: 'POST',
            body: JSON.stringify({
                growthMultiplier: result.multiplier,
                overloadedLinks: overloadedLinks,
                warningLinks: warningLinks,
                slaViolationsCurrent: result.currentSlaViolations,
                slaViolationsSimulated: result.simulatedSlaViolations,
                expansionPlanName: result.planName || null,
                expansionPlanData: result.planName ? result.planOverrides : null,
                bottleneckLinkId: result.bottleneck ? result.bottleneck.linkId : null,
                bottleneckLinkName: result.bottleneck ? result.bottleneck.linkName : null,
                recommendedBandwidths: recommendedBandwidths,
                topologySnapshot: {
                    linkCount: links.length,
                    flowCount: trafficFlows.length,
                    deviceCount: devices.length
                },
                timestamp: Date.now()
            })
        });
    } catch (err) {
        console.error('保存模拟结果失败:', err);
    }
}

async function loadCapacityHistory() {
    const container = document.getElementById('capacityHistoryList');
    container.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:15px;">加载中...</p>';

    try {
        const resp = await apiRequest('/api/capacity-simulations?limit=20');
        if (!resp || !resp.success || !resp.data || resp.data.length === 0) {
            container.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:15px;">暂无历史记录</p>';
            return;
        }

        let html = '';
        resp.data.forEach(record => {
            const time = new Date(record.timestamp).toLocaleString('zh-CN');
            let overloaded = [];
            try { overloaded = typeof record.overloadedLinks === 'string' ? JSON.parse(record.overloadedLinks) : (record.overloadedLinks || []); } catch (e) {}

            const growthMult = record.growthMultiplier !== undefined ? record.growthMultiplier.toFixed(1) : '?';
            const slaCurrent = record.slaViolationsCurrent !== undefined ? record.slaViolationsCurrent : '?';
            const slaSimulated = record.slaViolationsSimulated !== undefined ? record.slaViolationsSimulated : '?';
            const planName = record.expansionPlanName || '';

            html += `
                <div class="capacity-history-item">
                    <div class="capacity-history-header">
                        <span class="capacity-history-multiplier">${growthMult}x 增长</span>
                        <span class="capacity-history-time">${time}</span>
                    </div>
                    <div class="capacity-history-meta">
                        <span class="capacity-history-tag overload">超载${overloaded.length}条</span>
                        <span class="capacity-history-tag sla">SLA ${slaCurrent}→${slaSimulated}</span>
                        ${planName ? `<span class="capacity-history-tag plan">${escapeHtml(planName)}</span>` : ''}
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    } catch (err) {
        console.error('加载历史记录失败:', err);
        container.innerHTML = '<p class="hint" style="font-size:12px;color:#999;text-align:center;padding:15px;">加载失败</p>';
    }
}

function saveCapacityExpansionPlansToStorage() {
    try {
        localStorage.setItem('capacityExpansionPlans', JSON.stringify(capacityExpansionPlans));
        localStorage.setItem('capacityPlanIdCounter', capacityPlanIdCounter.toString());
    } catch (e) {
        console.error('保存扩容方案失败:', e);
    }
}

function loadCapacityExpansionPlansFromStorage() {
    try {
        const saved = localStorage.getItem('capacityExpansionPlans');
        const savedCounter = localStorage.getItem('capacityPlanIdCounter');
        if (saved) {
            capacityExpansionPlans = JSON.parse(saved);
        }
        if (savedCounter) {
            capacityPlanIdCounter = parseInt(savedCounter);
        }
    } catch (e) {
        console.error('加载扩容方案失败:', e);
    }
}

initCapacityPlanningModule();
