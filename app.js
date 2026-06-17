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

function init() {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    setupCanvasEvents();
    setupDeviceDrag();
    setupUIEvents();
    setupModalEvents();
    setupContextMenu();
    
    updateDeviceCount();
    updateDeviceSelects();
    updateFaultStats();
    
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
                draggedDevice = device;
                dragOffset = {
                    x: worldPos.x - device.x,
                    y: worldPos.y - device.y
                };
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
        
        if (draggedDevice) {
            draggedDevice.x = worldPos.x - dragOffset.x;
            draggedDevice.y = worldPos.y - dragOffset.y;
            updateRoutingTables();
        }
        
        if (isLinking) {
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
        
        if (isLinking) {
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
    
    return device;
}

function deleteDevice(deviceId) {
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

function addLink(fromId, toId, bandwidth, delay) {
    const link = {
        id: linkIdCounter++,
        from: fromId,
        to: toId,
        bandwidth: bandwidth,
        delay: delay,
        enabled: true
    };
    
    links.push(link);
    recalculateRoutes();
    
    return link;
}

function deleteLink(linkId) {
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
}

function toggleLinkEnabled(linkId) {
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
    
    handleLinkStateChange();
}

function handleLinkStateChange() {
    recalculateRoutes();
    rerouteAffectedFlows();
    updatePropertyPanel();
    updateFaultStats();
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

function injectTraffic(srcId, dstId, dataSizeKB, rateMbps) {
    if (trafficFlows.length >= MAX_TRAFFIC_FLOWS) {
        addLog('活跃流量已达上限（10条）', 'error');
        return false;
    }
    
    const pathResult = getPath(srcId, dstId);
    if (!pathResult) {
        addLog(`从 ${getDeviceName(srcId)} 到 ${getDeviceName(dstId)} 不可达`, 'error');
        return false;
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
        completed: false
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
        linkLoads.set(link.id, { totalRequest: 0, flows: [] });
    });
    
    trafficFlows.forEach(flow => {
        if (!flow.path || flow.completed || flow.paused) return;
        
        flow.actualRate = flow.rate;
        
        flow.path.segments.forEach(seg => {
            const loadInfo = linkLoads.get(seg.link.id);
            if (loadInfo) {
                loadInfo.totalRequest += flow.rate;
                loadInfo.flows.push(flow);
            }
        });
    });
    
    links.forEach(link => {
        const loadInfo = linkLoads.get(link.id);
        const loadRatio = loadInfo.totalRequest / (link.bandwidth * 1000000);
        
        if (loadRatio > 1) {
            const ratio = (link.bandwidth * 1000000) / loadInfo.totalRequest;
            loadInfo.flows.forEach(flow => {
                const limitedRate = flow.rate * ratio;
                if (limitedRate < flow.actualRate) {
                    flow.actualRate = limitedRate;
                }
            });
            
            if (!congestionStates.has(link.id)) {
                congestionStates.set(link.id, {
                    startTime: Date.now(),
                    packetLossActive: false
                });
            } else {
                const state = congestionStates.get(link.id);
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
    
    ctx.save();
    ctx.translate(device.x, device.y);
    
    if (isSelected) {
        ctx.beginPath();
        ctx.arc(0, 0, DEVICE_RADIUS + 5, 0, Math.PI * 2);
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
    
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = isDisabled ? '#d9d9d9' : '#999';
    ctx.lineWidth = 1;
    
    const label = isDisabled ? '已禁用' : `${link.bandwidth}Mbps/${link.delay}ms`;
    ctx.font = '10px -apple-system, sans-serif';
    const textWidth = ctx.measureText(label).width;
    
    ctx.fillRect(midX - textWidth/2 - 4, midY - 7, textWidth + 8, 14);
    ctx.strokeRect(midX - textWidth/2 - 4, midY - 7, textWidth + 8, 14);
    
    ctx.fillStyle = isDisabled ? '#bfbfbf' : '#666';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, midX, midY);
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
    
    ctx.fillStyle = '#1890ff';
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
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
        const srcId = parseInt(document.getElementById('srcDevice').value);
        const dstId = parseInt(document.getElementById('dstDevice').value);
        const dataSize = parseFloat(document.getElementById('dataSize').value);
        const rate = parseFloat(document.getElementById('sendRate').value);
        
        if (!srcId || !dstId) {
            alert('请选择源设备和目的设备');
            return;
        }
        
        if (srcId === dstId) {
            alert('源设备和目的设备不能相同');
            return;
        }
        
        injectTraffic(srcId, dstId, dataSize, rate);
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
    document.getElementById('linkConfigModal').classList.add('show');
}

function confirmLinkConfig() {
    if (!pendingLinkConfig) return;
    
    const bandwidth = parseInt(document.getElementById('linkBandwidth').value);
    const delay = parseInt(document.getElementById('linkDelay').value);
    
    if (bandwidth < 1 || bandwidth > 10000) {
        alert('带宽范围: 1-10000 Mbps');
        return;
    }
    
    if (delay < 1 || delay > 500) {
        alert('延迟范围: 1-500 ms');
        return;
    }
    
    addLink(pendingLinkConfig.from.id, pendingLinkConfig.to.id, bandwidth, delay);
    
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
        
        html += `<div class="${itemClass}">
            <div>
                <div>${src?.name || '-'} → ${dst?.name || '-'}</div>
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
            enabled: l.enabled
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
                enabled: l.enabled !== undefined ? l.enabled : true 
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
        html += `<div class="event-item">
            <div class="event-item-header">
                <span class="event-item-time">T+${e.time.toFixed(1)}s</span>
                ${isRunning ? '' : `<span class="event-item-delete" onclick="deleteEvent(${e.id})">×</span>`}
            </div>
            <div class="event-item-detail">
                ${src?.name || '-'} → ${dst?.name || '-'}<br>
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
            const success = injectTraffic(event.srcId, event.dstId, event.dataSize, event.rate);
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
        scenarioLinkSamples.get(link.id).push({
            time: Math.round(sampleTime * 10) / 10,
            load: load
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

    scenarioFlowResults.push({
        eventId: event.id,
        srcId: event.srcId,
        dstId: event.dstId,
        dataSize: event.dataSize,
        rate: event.rate,
        duration: duration,
        lossRate: lossRate,
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
        linkStats.push({
            linkId: link.id,
            linkName: `${getDeviceName(link.from)} - ${getDeviceName(link.to)}`,
            bandwidth: link.bandwidth,
            peakLoad: peakLoad,
            avgLoad: avgLoad,
            congestedDuration: congestedDuration,
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
            
            html += `<div class="report-link-item" style="display:block;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <span class="report-link-name">${escapeHtml(ls.linkName)}</span>
                    <span class="report-link-stats">
                        <span>峰值: ${(ls.peakLoad * 100).toFixed(1)}%</span>
                        <span>均值: ${(ls.avgLoad * 100).toFixed(1)}%</span>
                        <span>拥塞: ${ls.congestedDuration.toFixed(1)}s</span>
                    </span>
                </div>
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
            const statusText = fd.failed 
                ? (fd.failedReason === 'unreachable' ? '不可达' : '已中止')
                : '完成';
            html += `<div class="report-flow-item">
                <div class="report-flow-item-header">
                    <span class="report-flow-name">T+${fd.time.toFixed(1)}s ${escapeHtml(fd.src)} → ${escapeHtml(fd.dst)}</span>
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

const originalInit = init;
init = function() {
    originalInit();
    setupScenarioEvents();
    updateScenarioDeviceSelects();
    renderScenarioList();
};

init();
