/* =========================================================
   QUANTUM TREE  –  Professional ML Decision Visualizer v2.0
   JS Engine: D3.js tree + CART algorithm + animated build
   ========================================================= */

"use strict";

// ── Global State ────────────────────────────────────────────
let rawDataset = [];        // array of row-objects {feature: value, ...}
let featureNames = [];      // all feature names
let labelName = "";         // target column name
let builtTree = null;       // the constructed tree root
let featureTypes = {};      // {featureName: 'numerical' | 'categorical'}
let criterion = "entropy";
let animSpeed = 2;          // 1 slow, 2 medium, 3 fast
let animSteps = [];         // queue of node-ids to reveal during animation
let svgSelection = null;
let zoomBehavior = null;

const SPEED_MS = { 1: 900, 2: 420, 3: 120 };

// ── Color Scales ────────────────────────────────────────────
const CLASS_COLORS = d3.scaleOrdinal(["#00f2fe","#f093fb","#43e97b","#f5a623","#ff6b6b","#8e54e9"]);

// ══════════════════════════════════════════════════════════════
//  SECTION 1 – MATH ENGINE (CART Decision Tree)
// ══════════════════════════════════════════════════════════════

function impurity(rows) {
    if (rows.length === 0) return 0;
    const counts = classCounts(rows);
    const total = rows.length;
    if (criterion === "entropy") {
        let ent = 0;
        for (let c in counts) { const p = counts[c]/total; ent -= p * Math.log2(p + 1e-10); }
        return ent;
    } else {
        // Gini
        let g = 1;
        for (let c in counts) { const p = counts[c]/total; g -= p*p; }
        return g;
    }
}

function classCounts(rows) {
    const counts = {};
    rows.forEach(r => { const l = r[labelName]; counts[l] = (counts[l]||0) + 1; });
    return counts;
}

function majorityClass(rows) {
    const c = classCounts(rows);
    return Object.entries(c).sort((a,b) => b[1]-a[1])[0][0];
}

function infoGain(parent, left, right) {
    const n = parent.length, nl = left.length, nr = right.length;
    return impurity(parent) - (nl/n)*impurity(left) - (nr/n)*impurity(right);
}

// ── Best split for a CATEGORICAL feature ──
function bestCategoricalSplit(rows, feature) {
    const values = [...new Set(rows.map(r => r[feature]))];
    let bestGain = -Infinity, bestValue = null;
    for (const v of values) {
        const left  = rows.filter(r => r[feature] === v);
        const right = rows.filter(r => r[feature] !== v);
        if (left.length === 0 || right.length === 0) continue;
        const gain = infoGain(rows, left, right);
        if (gain > bestGain) { bestGain = gain; bestValue = v; }
    }
    return bestGain <= 1e-10
        ? null
        : { feature, type:"categorical", value: bestValue, gain: bestGain,
            split: rows => rows[feature] === bestValue ? "left" : "right" };
}

// ── Best split for a NUMERICAL feature (CART midpoint search) ──
function bestNumericalSplit(rows, feature) {
    const sorted = [...new Set(rows.map(r => +r[feature]))].sort((a,b) => a-b);
    const thresholds = sorted.slice(0,-1).map((v,i) => (v + sorted[i+1]) / 2);
    let bestGain = -Infinity, bestThreshold = null;
    for (const t of thresholds) {
        const left  = rows.filter(r => +r[feature] <= t);
        const right = rows.filter(r => +r[feature] >  t);
        if (left.length === 0 || right.length === 0) continue;
        const gain = infoGain(rows, left, right);
        if (gain > bestGain) { bestGain = gain; bestThreshold = t; }
    }
    return bestGain <= 1e-10
        ? null
        : { feature, type:"numerical", threshold: bestThreshold, gain: bestGain,
            split: rows => +rows[feature] <= bestThreshold ? "left" : "right" };
}

// ── Find globally best split across all features ──
function findBestSplit(rows, features) {
    let best = null;
    for (const f of features) {
        const candidate = featureTypes[f] === "numerical"
            ? bestNumericalSplit(rows, f)
            : bestCategoricalSplit(rows, f);
        if (candidate && (!best || candidate.gain > best.gain)) best = candidate;
    }
    return best;
}

// ── Recursive CART tree builder ──
let nodeIdCounter = 0;
function buildCART(rows, depth, maxDepth, minSamples) {
    const id = nodeIdCounter++;
    const counts = classCounts(rows);
    const leafLabel = majorityClass(rows);
    const nodeImpurity = impurity(rows);
    const base = { id, depth, samples: rows.length, counts, impurity: nodeImpurity, majorClass: leafLabel };

    // Termination
    if (depth >= maxDepth || rows.length < minSamples || nodeImpurity < 1e-10) {
        return { ...base, type:"leaf", label: leafLabel };
    }

    const features = featureNames.slice();
    const split = findBestSplit(rows, features);
    if (!split) return { ...base, type:"leaf", label: leafLabel };

    const leftRows  = rows.filter(r => split.split(r) === "left");
    const rightRows = rows.filter(r => split.split(r) === "right");
    if (leftRows.length === 0 || rightRows.length === 0) return { ...base, type:"leaf", label: leafLabel };

    const edgeLabel = split.type === "numerical"
        ? { left: `≤ ${split.threshold.toFixed(3)}`, right: `> ${split.threshold.toFixed(3)}` }
        : { left: `= ${split.value}`, right: `≠ ${split.value}` };

    return {
        ...base, type:"internal",
        feature: split.feature,
        splitType: split.type,
        splitValue: split.type === "numerical" ? split.threshold : split.value,
        gain: split.gain,
        edgeLabel,
        children: [
            buildCART(leftRows,  depth+1, maxDepth, minSamples),
            buildCART(rightRows, depth+1, maxDepth, minSamples)
        ]
    };
}

// ── Convert tree to D3-hierarchy flat structure ──
function flattenTree(node, parent = null, edgeFromParent = "") {
    const flat = [];
    function walk(n, p, edge) {
        flat.push({ id: n.id, data: n, parentId: p ? p.id : null, edgeLabel: edge });
        if (n.children) {
            walk(n.children[0], n, n.edgeLabel.left);
            walk(n.children[1], n, n.edgeLabel.right);
        }
    }
    walk(node, parent, edgeFromParent);
    return flat;
}

// ── Tree statistics ──
function treeStats(root) {
    let nodes = 0, leaves = 0, maxDepth = 0;
    function walk(n) {
        nodes++;
        if (n.depth > maxDepth) maxDepth = n.depth;
        if (n.type === "leaf") leaves++;
        if (n.children) n.children.forEach(walk);
    }
    walk(root);
    return { nodes, leaves, maxDepth };
}

// ══════════════════════════════════════════════════════════════
//  SECTION 2 – DATASETS
// ══════════════════════════════════════════════════════════════

const DATASETS = {
    tennis: {
        title: "Play Tennis (14 samples, 4 features)",
        featureTypes: { Outlook:"categorical", Temperature:"categorical", Humidity:"categorical", Wind:"categorical" },
        headers: ["Outlook","Temperature","Humidity","Wind","Play"],
        rows: [
            ["Sunny","Hot","High","Weak","No"],["Sunny","Hot","High","Strong","No"],
            ["Overcast","Hot","High","Weak","Yes"],["Rain","Mild","High","Weak","Yes"],
            ["Rain","Cool","Normal","Weak","Yes"],["Rain","Cool","Normal","Strong","No"],
            ["Overcast","Cool","Normal","Strong","Yes"],["Sunny","Mild","High","Weak","No"],
            ["Sunny","Cool","Normal","Weak","Yes"],["Rain","Mild","Normal","Weak","Yes"],
            ["Sunny","Mild","Normal","Strong","Yes"],["Overcast","Mild","High","Strong","Yes"],
            ["Overcast","Hot","Normal","Weak","Yes"],["Rain","Mild","High","Strong","No"]
        ]
    },
    iris: {
        title: "Iris Flower (150 samples, 4 numerical features)",
        featureTypes: { sepal_length:"numerical", sepal_width:"numerical", petal_length:"numerical", petal_width:"numerical" },
        headers: ["sepal_length","sepal_width","petal_length","petal_width","species"],
        rows: [
            [5.1,3.5,1.4,0.2,"setosa"],[4.9,3.0,1.4,0.2,"setosa"],[4.7,3.2,1.3,0.2,"setosa"],
            [4.6,3.1,1.5,0.2,"setosa"],[5.0,3.6,1.4,0.2,"setosa"],[5.4,3.9,1.7,0.4,"setosa"],
            [4.6,3.4,1.4,0.3,"setosa"],[5.0,3.4,1.5,0.2,"setosa"],[4.4,2.9,1.4,0.2,"setosa"],
            [4.9,3.1,1.5,0.1,"setosa"],[5.4,3.7,1.5,0.2,"setosa"],[4.8,3.4,1.6,0.2,"setosa"],
            [4.8,3.0,1.4,0.1,"setosa"],[4.3,3.0,1.1,0.1,"setosa"],[5.8,4.0,1.2,0.2,"setosa"],
            [5.7,4.4,1.5,0.4,"setosa"],[5.4,3.9,1.3,0.4,"setosa"],[5.1,3.5,1.4,0.3,"setosa"],
            [5.7,3.8,1.7,0.3,"setosa"],[5.1,3.8,1.5,0.3,"setosa"],
            [7.0,3.2,4.7,1.4,"versicolor"],[6.4,3.2,4.5,1.5,"versicolor"],
            [6.9,3.1,4.9,1.5,"versicolor"],[5.5,2.3,4.0,1.3,"versicolor"],
            [6.5,2.8,4.6,1.5,"versicolor"],[5.7,2.8,4.5,1.3,"versicolor"],
            [6.3,3.3,4.7,1.6,"versicolor"],[4.9,2.4,3.3,1.0,"versicolor"],
            [6.6,2.9,4.6,1.3,"versicolor"],[5.2,2.7,3.9,1.4,"versicolor"],
            [5.0,2.0,3.5,1.0,"versicolor"],[5.9,3.0,4.2,1.5,"versicolor"],
            [6.0,2.2,4.0,1.0,"versicolor"],[6.1,2.9,4.7,1.4,"versicolor"],
            [5.6,2.9,3.6,1.3,"versicolor"],[6.7,3.1,4.4,1.4,"versicolor"],
            [5.6,3.0,4.5,1.5,"versicolor"],[5.8,2.7,4.1,1.0,"versicolor"],
            [6.2,2.2,4.5,1.5,"versicolor"],[5.6,2.5,3.9,1.1,"versicolor"],
            [6.3,2.5,4.9,1.5,"versicolor"],[6.1,2.8,4.7,1.2,"versicolor"],
            [6.4,2.9,4.3,1.3,"versicolor"],[6.6,3.0,4.4,1.4,"versicolor"],
            [6.8,2.8,4.8,1.4,"versicolor"],[6.7,3.0,5.0,1.7,"versicolor"],
            [6.0,2.9,4.5,1.5,"versicolor"],[5.7,2.6,3.5,1.0,"versicolor"],
            [5.5,2.4,3.8,1.1,"versicolor"],[5.5,2.4,3.7,1.0,"versicolor"],
            [6.3,3.3,6.0,2.5,"virginica"],[5.8,2.7,5.1,1.9,"virginica"],
            [7.1,3.0,5.9,2.1,"virginica"],[6.3,2.9,5.6,1.8,"virginica"],
            [6.5,3.0,5.8,2.2,"virginica"],[7.6,3.0,6.6,2.1,"virginica"],
            [4.9,2.5,4.5,1.7,"virginica"],[7.3,2.9,6.3,1.8,"virginica"],
            [6.7,2.5,5.8,1.8,"virginica"],[7.2,3.6,6.1,2.5,"virginica"],
            [6.5,3.2,5.1,2.0,"virginica"],[6.4,2.7,5.3,1.9,"virginica"],
            [6.8,3.0,5.5,2.1,"virginica"],[5.7,2.5,5.0,2.0,"virginica"],
            [5.8,2.8,5.1,2.4,"virginica"],[6.4,3.2,5.3,2.3,"virginica"],
            [6.5,3.0,5.5,1.8,"virginica"],[7.7,3.8,6.7,2.2,"virginica"],
            [7.7,2.6,6.9,2.3,"virginica"],[6.0,2.2,5.0,1.5,"virginica"]
        ]
    },
    titanic: {
        title: "Titanic Survival (mixed numerical + categorical)",
        featureTypes: { Pclass:"numerical", Sex:"categorical", Age:"numerical", SibSp:"numerical", Fare:"numerical" },
        headers: ["Pclass","Sex","Age","SibSp","Fare","Survived"],
        rows: [
            [3,"male",22,1,7.25,"No"],[1,"female",38,1,71.28,"Yes"],
            [3,"female",26,0,7.925,"Yes"],[1,"female",35,1,53.1,"Yes"],
            [3,"male",35,0,8.05,"No"],[3,"male",28,0,8.458,"No"],
            [1,"male",54,0,51.86,"No"],[3,"male",2,3,21.075,"No"],
            [3,"female",27,0,11.133,"Yes"],[2,"female",14,1,30.07,"Yes"],
            [3,"female",4,1,16.7,"Yes"],[1,"female",58,0,26.55,"Yes"],
            [3,"male",20,0,8.05,"No"],[3,"male",39,1,31.275,"No"],
            [3,"female",14,0,7.854,"No"],[2,"female",55,0,16.0,"Yes"],
            [3,"male",2,4,29.125,"No"],[2,"male",28,0,13.0,"Yes"],
            [3,"female",31,1,18.0,"No"],[3,"female",28,0,7.225,"Yes"],
            [2,"male",35,0,26.0,"No"],[1,"male",34,0,13.0,"Yes"],
            [3,"female",15,0,8.029,"No"],[1,"male",28,0,35.5,"Yes"],
            [3,"female",8,3,21.075,"Yes"],[3,"female",38,1,31.387,"Yes"],
            [1,"male",19,3,263.0,"No"],[3,"female",28,0,7.879,"Yes"],
            [2,"male",40,0,0,"No"],[1,"female",24,0,83.155,"Yes"],
            [1,"male",28,0,30.5,"No"],[3,"male",25,0,7.05,"No"],
            [3,"female",28,3,15.5,"Yes"],[1,"female",48,1,65.0,"Yes"],
            [3,"male",22,0,6.975,"No"],[1,"male",60,1,75.25,"No"],
            [3,"female",28,1,14.5,"Yes"],[1,"female",36,0,135.6333,"Yes"],
            [2,"male",19,0,13.0,"No"],[3,"female",28,0,7.733,"Yes"],
            [2,"male",22,0,10.5,"No"],[3,"female",28,1,39.6875,"Yes"],
            [1,"male",46,0,79.2,"No"],[3,"male",23,0,7.896,"No"],
            [3,"female",63,1,77.9583,"No"],[2,"male",47,0,15.0,"No"],
            [3,"male",28,1,7.75,"No"],[1,"female",42,0,227.525,"Yes"],
            [2,"male",21,0,11.5,"No"],[3,"female",18,0,7.4958,"Yes"],
            [3,"female",14,0,8.7125,"No"],[2,"male",40,0,15.1,"No"],
            [3,"female",27,2,11.1333,"Yes"],[1,"female",55,0,25.925,"Yes"]
        ]
    }
};

function loadDataset(key) {
    const ds = DATASETS[key];
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    document.querySelectorAll(".chip").forEach(c => {
        if (c.textContent.toLowerCase().includes(key.slice(0,3))) c.classList.add("active");
    });
    featureTypes = { ...ds.featureTypes };
    const headers = ds.headers;
    labelName = headers[headers.length - 1];
    featureNames = headers.slice(0, -1);
    rawDataset = ds.rows.map(row => {
        const obj = {};
        headers.forEach((h,i) => obj[h] = row[i]);
        return obj;
    });
    document.getElementById("fileLabel").textContent = ds.title;
    document.getElementById("treeTitle").textContent = ds.title;
    runBuild();
}

// ── CSV file parse ──
document.getElementById("csvFile").addEventListener("change", function(e) {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById("fileLabel").textContent = file.name;
    const reader = new FileReader();
    reader.onload = ev => {
        const lines = ev.target.result.trim().split("\n").map(l => l.split(",").map(s => s.trim()));
        const headers = lines[0];
        labelName = headers[headers.length - 1];
        featureNames = headers.slice(0,-1);
        rawDataset = lines.slice(1).map(row => {
            const obj = {};
            headers.forEach((h,i) => obj[h] = row[i]);
            return obj;
        });
        // auto-detect feature types
        featureTypes = {};
        featureNames.forEach(f => {
            const sample = rawDataset.map(r => r[f]).filter(v => v !== undefined && v !== "");
            const numericCount = sample.filter(v => !isNaN(+v)).length;
            featureTypes[f] = numericCount / sample.length > 0.8 ? "numerical" : "categorical";
        });
        document.getElementById("treeTitle").textContent = `Custom: ${file.name}`;
        runBuild();
    };
    reader.readAsText(file);
});

// ══════════════════════════════════════════════════════════════
//  SECTION 3 – D3 RENDERING
// ══════════════════════════════════════════════════════════════

const NODE_W = 180, NODE_H = 80;
const LINK_COLOR = "#00f2fe";

function initSVG() {
    const svg = d3.select("#treeSvg");
    svg.style("display","block");
    document.getElementById("emptyState").style.display = "none";

    // gradient for links
    const defs = svg.select("defs");
    if (defs.select("#linkGradient").empty()) {
        const lg = defs.append("linearGradient").attr("id","linkGradient")
            .attr("gradientUnits","userSpaceOnUse");
        lg.append("stop").attr("offset","0%").attr("stop-color","#00f2fe").attr("stop-opacity","0.7");
        lg.append("stop").attr("offset","100%").attr("stop-color","#4facfe").attr("stop-opacity","0.3");
    }

    const g = d3.select("#treeG");
    g.selectAll("*").remove();

    zoomBehavior = d3.zoom()
        .scaleExtent([0.1, 3])
        .on("zoom", e => g.attr("transform", e.transform));
    svg.call(zoomBehavior);

    svgSelection = svg;
    return g;
}

function layoutTree(root) {
    // Use D3 tree layout
    const treeLayout = d3.tree()
        .nodeSize([NODE_W + 40, NODE_H + 80])
        .separation((a, b) => a.parent === b.parent ? 1 : 1.4);

    const hierarchy = d3.hierarchy(root, d => d.children);
    treeLayout(hierarchy);
    return hierarchy;
}

function renderD3Tree(root, animateStepByStep = true) {
    const g = initSVG();
    const hier = layoutTree(root);
    const nodes = hier.descendants();
    const links = hier.links();
    const stats = treeStats(root);

    // center the view
    const svgEl = document.getElementById("treeSvg");
    const W = svgEl.clientWidth, H = svgEl.clientHeight;
    const initTransform = d3.zoomIdentity
        .translate(W/2, 80)
        .scale(Math.min(1, W / (stats.nodes * (NODE_W + 20))));
    svgSelection.call(zoomBehavior.transform, initTransform);

    // ── Draw all links (hidden initially if step anim) ──
    const linkGroup = g.append("g").attr("class","link-group");
    const linkSel = linkGroup.selectAll(".link")
        .data(links)
        .join("path")
        .attr("class","link")
        .attr("id", d => `link-${d.source.data.id}-${d.target.data.id}`)
        .attr("d", d => d3.linkVertical().x(n => n.x).y(n => n.y)(d))
        .attr("stroke", LINK_COLOR)
        .style("opacity", animateStepByStep ? 0 : 0.5);

    // ── Link labels ──
    const labelGroup = g.append("g").attr("class","link-label-group");
    labelGroup.selectAll(".link-label")
        .data(links)
        .join("text")
        .attr("class","link-label")
        .attr("id", d => `lbl-${d.source.data.id}-${d.target.data.id}`)
        .attr("x", d => (d.source.x + d.target.x) / 2)
        .attr("y", d => (d.source.y + d.target.y) / 2)
        .attr("text-anchor","middle")
        .attr("dy","-4")
        .text(d => d.target.data.edgeLabel || "")
        .style("opacity", animateStepByStep ? 0 : 1);

    // ── Draw node groups ──
    const nodeGroup = g.append("g").attr("class","node-group-container");
    const nodeEnter = nodeGroup.selectAll(".node-group")
        .data(nodes)
        .join("g")
        .attr("class","node-group")
        .attr("id", d => `node-${d.data.id}`)
        .attr("transform", d => `translate(${d.x},${d.y})`)
        .style("opacity", animateStepByStep ? 0 : 1)
        .on("mouseover", (event, d) => showTooltip(event, d.data))
        .on("mouseout", hideTooltip)
        .on("click", (event, d) => showModal(d.data));

    // Background rect
    nodeEnter.each(function(d) {
        const grp = d3.select(this);
        const isLeaf = d.data.type === "leaf";
        const color = isLeaf ? (CLASS_COLORS(d.data.label)) : LINK_COLOR;

        // Card shadow
        grp.append("rect")
            .attr("x", -NODE_W/2 + 3).attr("y", -NODE_H/2 + 3)
            .attr("width", NODE_W).attr("height", NODE_H)
            .attr("rx",12).attr("ry",12)
            .attr("fill","rgba(0,0,0,0.4)");

        // Card bg
        const bg = grp.append("rect").attr("class","node-bg")
            .attr("x", -NODE_W/2).attr("y", -NODE_H/2)
            .attr("width", NODE_W).attr("height", NODE_H)
            .attr("rx",12).attr("ry",12)
            .attr("fill", isLeaf ? hexToRgba(CLASS_COLORS(d.data.label), 0.18) : "rgba(255,255,255,0.06)")
            .attr("stroke", color)
            .attr("stroke-width", isLeaf ? 1.5 : 1)
            .attr("id", `bg-${d.data.id}`);

        // Left accent bar
        grp.append("rect")
            .attr("x", -NODE_W/2).attr("y", -NODE_H/2 + 6)
            .attr("width",4).attr("height", NODE_H - 12)
            .attr("rx",2).attr("fill", color);

        const textX = -NODE_W/2 + 14;

        if (isLeaf) {
            // Leaf node content
            grp.append("text").attr("class","node-header-text")
                .attr("x", textX).attr("y", -NODE_H/2 + 16)
                .text("PREDICTION");

            const predLabel = d.data.label;
            grp.append("text").attr("class","node-main-text")
                .attr("x", textX).attr("y", -NODE_H/2 + 32)
                .attr("fill", CLASS_COLORS(predLabel))
                .text(predLabel.length > 14 ? predLabel.slice(0,14)+"…" : predLabel);

            // Samples + purity
            grp.append("text").attr("class","node-sub-text")
                .attr("x", textX).attr("y", -NODE_H/2 + 46)
                .text(`samples: ${d.data.samples}  |  impurity: ${d.data.impurity.toFixed(3)}`);

            // Distribution bar
            drawDistBar(grp, d.data, textX, -NODE_H/2 + 58, NODE_W - 20);
        } else {
            // Internal node content
            grp.append("text").attr("class","node-header-text")
                .attr("x", textX).attr("y", -NODE_H/2 + 16)
                .text(`${featureTypes[d.data.feature]==="numerical"?"NUMERICAL SPLIT":"CATEGORICAL SPLIT"}`);

            const featName = d.data.feature;
            grp.append("text").attr("class","node-main-text")
                .attr("x", textX).attr("y", -NODE_H/2 + 32)
                .text(featName.length > 14 ? featName.slice(0,14)+"…" : featName);

            const condition = featureTypes[featName] === "numerical"
                ? `≤ ${(+d.data.splitValue).toFixed(3)}`
                : `= ${d.data.splitValue}`;

            grp.append("text").attr("class","node-sub-text")
                .attr("x", textX).attr("y", -NODE_H/2 + 46)
                .attr("fill","#f5a623")
                .text(condition);

            grp.append("text").attr("class","node-sub-text")
                .attr("x", textX).attr("y", -NODE_H/2 + 60)
                .text(`n=${d.data.samples}  IG=${d.data.gain.toFixed(3)}`);

            // Impurity bar
            drawImpurityBar(grp, d.data.impurity, textX, -NODE_H/2 + 68, NODE_W - 20);
        }
    });

    if (!animateStepByStep) {
        // Instant render with GSAP scale-in
        gsap.from(".node-group", {
            scale:0, opacity:0, stagger:0.04, duration:0.5, ease:"back.out(1.7)",
            transformOrigin:"center center"
        });
        showStats(stats, rawDataset.length);
        return;
    }

    // ── Step-by-step BFS animation ──
    animSteps = nodes.map(n => n.data.id); // BFS order from D3
    startStepAnimation(animSteps, nodes, links, linkSel, labelGroup, nodeEnter, stats);
}

function drawDistBar(grp, nodeData, x, y, width) {
    const counts = nodeData.counts;
    const total = nodeData.samples;
    const classes = Object.keys(counts);
    let cx = x;
    grp.append("rect").attr("x",x).attr("y",y).attr("width",width-4).attr("height",5)
        .attr("rx",3).attr("fill","rgba(255,255,255,0.06)");
    classes.forEach(cls => {
        const w = ((counts[cls]/total) * (width-4));
        grp.append("rect").attr("x",cx).attr("y",y).attr("width",w).attr("height",5)
            .attr("rx",3).attr("fill", CLASS_COLORS(cls)).attr("opacity",0.7);
        cx += w;
    });
}

function drawImpurityBar(grp, val, x, y, width) {
    const maxImp = criterion === "entropy" ? 1 : 0.5;
    const ratio = Math.min(val / maxImp, 1);
    grp.append("rect").attr("class","node-impurity-bar-bg")
        .attr("x",x).attr("y",y).attr("width",width-4).attr("height",4).attr("rx",2);
    grp.append("rect").attr("class","node-impurity-bar")
        .attr("x",x).attr("y",y).attr("width",(width-4)*ratio).attr("height",4).attr("rx",2)
        .attr("fill",`hsl(${(1-ratio)*120},80%,55%)`);
}

// ── BFS step animation ──
let animTimer = null;
function startStepAnimation(steps, nodes, links, linkSel, labelGroup, nodeEnter, stats) {
    const progress = document.getElementById("animProgress");
    const fill = document.getElementById("progressFill");
    const lbl = document.getElementById("progressLabel");
    progress.style.display = "block";
    document.getElementById("replayBtn").style.display = "none";

    let i = 0;
    const delay = SPEED_MS[animSpeed];

    function revealNext() {
        if (i >= steps.length) {
            fill.style.width = "100%";
            lbl.textContent = "Tree complete! Click nodes for details.";
            setTimeout(() => {
                progress.style.display = "none";
                document.getElementById("replayBtn").style.display = "flex";
            }, 800);
            showStats(stats, rawDataset.length);
            return;
        }
        const nodeId = steps[i];
        const pct = ((i+1)/steps.length)*100;
        fill.style.width = pct + "%";

        const nodeEl = document.getElementById(`node-${nodeId}`);
        if (nodeEl) {
            d3.select(nodeEl).style("opacity",1);
            gsap.fromTo(nodeEl,
                { scale:0, opacity:0 },
                { scale:1, opacity:1, duration:0.35, ease:"back.out(1.7)",
                  transformOrigin:"center center",
                  onStart: () => {
                      const bg = document.getElementById(`bg-${nodeId}`);
                      if (bg) { bg.classList.add("splitting"); setTimeout(()=>bg.classList.remove("splitting"),600); }
                  }
                });
        }
        // Reveal links to this node
        linkSel.each(function(d) {
            if (d.target.data.id === nodeId) {
                d3.select(this).transition().duration(delay*0.8).style("opacity",0.5);
                const lbId = `lbl-${d.source.data.id}-${d.target.data.id}`;
                d3.select(`#${lbId}`).transition().duration(delay*0.8).style("opacity",1);
            }
        });

        const n = nodes.find(n => n.data.id === nodeId);
        if (n) lbl.textContent = n.data.type === "leaf"
            ? `🍃 Leaf → ${n.data.label} (${n.data.samples} samples)`
            : `🌿 Split on "${n.data.feature}" — IG: ${n.data.gain.toFixed(4)}`;

        i++;
        animTimer = setTimeout(revealNext, delay);
    }
    revealNext();
}

// ══════════════════════════════════════════════════════════════
//  SECTION 4 – CONTROLS & UI
// ══════════════════════════════════════════════════════════════

function setCriterion(c) {
    criterion = c;
    document.getElementById("pill-entropy").classList.toggle("active", c === "entropy");
    document.getElementById("pill-gini").classList.toggle("active", c === "gini");
}

function setSpeed(val) {
    animSpeed = +val;
    const labels = { 1:"Slow", 2:"Medium", 3:"Fast" };
    document.getElementById("speedLabel").textContent = labels[animSpeed];
}

function runBuild() {
    if (rawDataset.length === 0) { loadDataset("tennis"); return; }
    if (animTimer) { clearTimeout(animTimer); animTimer = null; }

    nodeIdCounter = 0;
    const maxDepth = +document.getElementById("maxDepth").value;
    const minSamples = +document.getElementById("minSamples").value;
    const animate = document.getElementById("animateToggle").checked;

    document.getElementById("buildBtn").textContent = "Building…";
    document.getElementById("replayBtn").style.display = "none";

    setTimeout(() => {
        builtTree = buildCART(rawDataset, 0, maxDepth, minSamples);
        renderD3Tree(builtTree, animate);
        document.getElementById("buildBtn").innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/></svg>Build Tree`;
    }, 50);
}

function replayAnimation() {
    if (!builtTree) return;
    if (animTimer) { clearTimeout(animTimer); animTimer = null; }
    renderD3Tree(builtTree, true);
}

function showStats(stats, nSamples) {
    document.getElementById("statNodes").textContent = stats.nodes;
    document.getElementById("statLeaves").textContent = stats.leaves;
    document.getElementById("statDepth").textContent = stats.maxDepth;
    document.getElementById("statSamples").textContent = nSamples;
    const panel = document.getElementById("statsPanel");
    panel.style.display = "block";
    gsap.from(panel, { opacity:0, y:10, duration:0.4 });
}

// ── Zoom controls ──
function zoomIn()   { svgSelection && svgSelection.transition().call(zoomBehavior.scaleBy, 1.4); }
function zoomOut()  { svgSelection && svgSelection.transition().call(zoomBehavior.scaleBy, 0.7); }
function resetZoom(){ svgSelection && svgSelection.transition().duration(600).call(zoomBehavior.transform, d3.zoomIdentity.translate(document.getElementById("treeSvg").clientWidth/2, 80)); }

// ── Export ──
function exportSVG() {
    const el = document.getElementById("treeSvg");
    const data = new XMLSerializer().serializeToString(el);
    const blob = new Blob([data], { type:"image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "quantum-tree.svg"; a.click();
    URL.revokeObjectURL(url);
}

// ── Tooltip ──
const tooltip = document.getElementById("nodeTooltip");
function showTooltip(event, d) {
    const classes = Object.entries(d.counts).map(([k,v]) => `${k}: ${v}`).join(" · ");
    tooltip.innerHTML = `
        <div class="tooltip-row"><span class="tooltip-key">Type</span><span class="tooltip-val">${d.type}</span></div>
        <div class="tooltip-row"><span class="tooltip-key">Samples</span><span class="tooltip-val">${d.samples}</span></div>
        <div class="tooltip-row"><span class="tooltip-key">${criterion==="entropy"?"Entropy":"Gini"}</span><span class="tooltip-val">${d.impurity.toFixed(4)}</span></div>
        ${d.type==="internal"?`<div class="tooltip-row"><span class="tooltip-key">Info Gain</span><span class="tooltip-val">${d.gain.toFixed(4)}</span></div>`:""}
        <div class="tooltip-row" style="margin-top:4px"><span class="tooltip-key" style="font-size:0.68rem">${classes}</span></div>
    `.trim();
    tooltip.classList.add("visible");
    moveTooltip(event);
}
function moveTooltip(event) {
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    let x = event.clientX + 12, y = event.clientY + 12;
    if (x + tw > window.innerWidth) x = event.clientX - tw - 12;
    if (y + th > window.innerHeight) y = event.clientY - th - 12;
    tooltip.style.left = x + "px"; tooltip.style.top = y + "px";
}
document.addEventListener("mousemove", e => { if(tooltip.classList.contains("visible")) moveTooltip(e); });
function hideTooltip() { tooltip.classList.remove("visible"); }

// ── Node Detail Modal ──
function showModal(d) {
    hideTooltip();
    const counts = d.counts;
    const total = d.samples;
    const classes = Object.keys(counts);
    const maxImp = criterion === "entropy" ? 1 : 0.5;

    let html = `<div class="modal-title">${d.type === "leaf" ? "🍃 Leaf Node" : "🌿 Decision Node"}</div>`;

    if (d.type === "internal") {
        html += `
        <div class="modal-section">
            <div class="modal-section-label">Split Rule</div>
            <div style="font-size:1rem;font-family:var(--mono);color:var(--accent2)">
                ${d.feature} ${featureTypes[d.feature]==="numerical" ? `≤ ${(+d.splitValue).toFixed(4)}` : `= ${d.splitValue}`}
            </div>
        </div>
        <div class="modal-section">
            <div class="modal-section-label">Information Gain</div>
            <div class="modal-impurity-row">
                <div class="modal-bar-bg"><div class="modal-bar-fill" style="width:${Math.min(d.gain/0.5,1)*100}%"></div></div>
                <span class="modal-val">${d.gain.toFixed(5)}</span>
            </div>
        </div>`;
    } else {
        html += `
        <div class="modal-section">
            <div class="modal-section-label">Predicted Class</div>
            <span style="font-size:1.2rem;font-weight:700;color:${CLASS_COLORS(d.label)}">${d.label}</span>
        </div>`;
    }

    html += `
    <div class="modal-section">
        <div class="modal-section-label">${criterion==="entropy"?"Entropy":"Gini"} Impurity</div>
        <div class="modal-impurity-row">
            <div class="modal-bar-bg"><div class="modal-bar-fill" style="width:${Math.min(d.impurity/maxImp,1)*100}%;background:hsl(${(1-(d.impurity/maxImp))*120},80%,55%)"></div></div>
            <span class="modal-val">${d.impurity.toFixed(5)}</span>
        </div>
    </div>
    <div class="modal-section">
        <div class="modal-section-label">Class Distribution (${total} samples)</div>
        ${classes.map(c => `<span class="modal-badge ${c.toLowerCase()==='yes'?'yes':c.toLowerCase()==='no'?'no':''}">${c}: ${counts[c]} (${(counts[c]/total*100).toFixed(1)}%)</span>`).join("")}
    </div>
    <div class="modal-section">
        <div class="modal-section-label">Node Coordinates</div>
        <span style="font-family:var(--mono);font-size:0.75rem;color:var(--text-muted)">depth=${d.depth}  id=${d.id}</span>
    </div>`;

    document.getElementById("modalContent").innerHTML = html;
    document.getElementById("modalOverlay").classList.add("open");
}
function closeModal() { document.getElementById("modalOverlay").classList.remove("open"); }

// ── Ambient canvas (particles) ──
function initBgCanvas() {
    const canvas = document.getElementById("bgCanvas");
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;

    const pts = Array.from({length:60}, () => ({
        x: Math.random()*canvas.width, y: Math.random()*canvas.height,
        vx: (Math.random()-0.5)*0.3, vy: (Math.random()-0.5)*0.3,
        r: Math.random()*1.5+0.5,
        alpha: Math.random()*0.4+0.1
    }));

    function draw() {
        ctx.clearRect(0,0,canvas.width,canvas.height);
        pts.forEach(p => {
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
            if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
            ctx.fillStyle = `rgba(0,242,254,${p.alpha})`;
            ctx.fill();
        });
        // Draw faint connecting lines for nearby particles
        for (let i=0;i<pts.length;i++) {
            for (let j=i+1;j<pts.length;j++) {
                const dx=pts[i].x-pts[j].x, dy=pts[i].y-pts[j].y;
                const dist=Math.sqrt(dx*dx+dy*dy);
                if (dist<100) {
                    ctx.beginPath();
                    ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[j].x,pts[j].y);
                    ctx.strokeStyle=`rgba(0,242,254,${(1-dist/100)*0.07})`;
                    ctx.lineWidth=0.5; ctx.stroke();
                }
            }
        }
        requestAnimationFrame(draw);
    }
    draw();
    window.addEventListener("resize", () => { canvas.width=window.innerWidth; canvas.height=window.innerHeight; });
}

// ── Utility ──
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// ── GSAP 3D tilt on sidebar ──
const sidebar = document.getElementById("sidebar");
document.addEventListener("mousemove", e => {
    const rx = (e.clientY / window.innerHeight - 0.5) * 4;
    const ry = (e.clientX / window.innerWidth - 0.5) * -4;
    gsap.to(sidebar, { duration:1, rotateX:rx, rotateY:ry, ease:"power2.out" });
});

// ── Init ──
window.addEventListener("DOMContentLoaded", () => {
    initBgCanvas();

    gsap.from(".sidebar", { duration:1.2, x:-60, opacity:0, ease:"expo.out" });
    gsap.from(".canvas-toolbar", { duration:1, y:-40, opacity:0, ease:"expo.out", delay:0.3 });

    // Auto-load the tennis dataset
    loadDataset("tennis");
    // Load saved-tree history from backend
    loadHistory();
});

window.addEventListener("resize", () => {
    if (builtTree) renderD3Tree(builtTree, false);
});


// ══════════════════════════════════════════════════════════════
//  SECTION 6 – BACKEND API LAYER
//  All fetch calls to the FastAPI backend on /api/*
// ══════════════════════════════════════════════════════════════

// ── Session identity ─────────────────────────────────────────
// Each browser gets a UUID stored in localStorage.
// This acts as an anonymous session — no login required.
const SESSION_ID = (() => {
    let id = localStorage.getItem("qt_session_id");
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem("qt_session_id", id);
    }
    return id;
})();

// Detect whether we're running on Vercel/server or locally from filesystem.
// If opened from filesystem (file://), try to connect to a local backend on port 8000.
const API_BASE = window.location.protocol === "file:" ? "http://localhost:8000" : "";

// ── Generic fetch helper ──────────────────────────────────────
async function apiFetch(path, options = {}) {
    if (!API_BASE && API_BASE !== "") {
        throw new Error("API not available when opening file:// locally. Deploy to Vercel first.");
    }
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json", ...options.headers },
        ...options,
    });
    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.detail || msg; } catch(_) {}
        throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
}

// ── Toast notification ────────────────────────────────────────
let toastTimer = null;
function showToast(message, type = "success") {
    const t = document.getElementById("toast");
    const icon = type === "success" ? "✅" : "❌";
    t.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    t.className = `toast show ${type}`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = "toast"; }, 3500);
}

// ── Save current dataset to cloud ────────────────────────────
let savedDatasetId = null;  // tracks if current dataset is already saved
let savedDatasetName = "";

async function saveDatasetToCloud() {
    if (!rawDataset.length) return showToast("No dataset loaded to save.", "error");
    const btn = document.getElementById("saveDataBtn");
    btn.classList.add("saving"); btn.textContent = "Saving…";

    const name = document.getElementById("treeTitle").textContent.split("(")[0].trim() || "Untitled Dataset";
    try {
        const result = await apiFetch("/api/datasets", {
            method: "POST",
            body: JSON.stringify({
                session_id:    SESSION_ID,
                name:          name,
                headers:       [...featureNames, labelName],
                rows:          rawDataset.map(r => [...featureNames, labelName].map(h => r[h])),
                feature_types: featureTypes,
            }),
        });
        savedDatasetId   = result.id;
        savedDatasetName = result.name;
        showToast(`Dataset "${name}" saved!`);
    } catch(e) {
        showToast(e.message, "error");
    } finally {
        btn.classList.remove("saving");
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Save Dataset`;
    }
}

// ── Save built tree to cloud ──────────────────────────────────
async function saveCurrentTree() {
    if (!builtTree) return showToast("Build a tree first before saving.", "error");
    const btn = document.getElementById("saveBtn");
    btn.classList.add("saving"); btn.textContent = "Saving…";

    const stats  = treeStats(builtTree);
    const name   = document.getElementById("treeTitle").textContent.split("(")[0].trim() || "Untitled";
    const maxD   = +document.getElementById("maxDepth").value;
    const minS   = +document.getElementById("minSamples").value;

    try {
        await apiFetch("/api/trees", {
            method: "POST",
            body: JSON.stringify({
                session_id:   SESSION_ID,
                dataset_id:   savedDatasetId || null,
                dataset_name: savedDatasetName || name,
                criterion,
                max_depth:    maxD,
                min_samples:  minS,
                tree_json:    builtTree,  // full JS tree object
                stats:        { nodes: stats.nodes, leaves: stats.leaves, maxDepth: stats.maxDepth },
            }),
        });
        showToast("Tree saved to your history!");
        loadHistory();  // refresh sidebar
    } catch(e) {
        showToast(e.message, "error");
    } finally {
        btn.classList.remove("saving");
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Tree`;
    }
}

// ── Load history from cloud ───────────────────────────────────
async function loadHistory() {
    // If running locally from filesystem, silently skip — no API available.
    if (window.location.protocol === "file:") return;

    const list = document.getElementById("historyList");
    try {
        const items = await apiFetch(`/api/trees?session_id=${SESSION_ID}&limit=20`);
        if (!items || items.length === 0) {
            list.innerHTML = `<div class="history-empty">No saved trees yet.<br>Build &amp; save a tree to see it here.</div>`;
            return;
        }
        list.innerHTML = items.map(item => {
            const date = new Date(item.created_at).toLocaleString(undefined, { month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" });
            return `
            <div class="history-card" onclick="loadSavedTree('${item.id}')">
                <button class="history-card-del" title="Delete" onclick="event.stopPropagation();deleteTree('${item.id}')">✕</button>
                <div class="history-card-title">${item.dataset_name}</div>
                <div class="history-card-meta">
                    <span class="history-card-badge">${item.criterion}</span>
                    <span class="history-card-badge">depth ${item.max_depth}</span>
                    <span class="history-card-badge">${item.stats?.nodes ?? "?"} nodes</span>
                </div>
                <div class="history-card-time">${date}</div>
            </div>`;
        }).join("");
        gsap.from(".history-card", { opacity:0, x:-10, stagger:0.06, duration:0.3, ease:"power2.out" });
    } catch(e) {
        list.innerHTML = `<div class="history-empty">Could not load history.<br><small>${e.message}</small></div>`;
    }
}

// ── Load a specific saved tree from cloud ─────────────────────
async function loadSavedTree(id) {
    try {
        showToast("Loading tree from cloud…");
        const session = await apiFetch(`/api/trees/${id}?session_id=${SESSION_ID}`);

        // Restore global state from the saved session
        criterion    = session.criterion;
        builtTree    = session.tree_json;
        document.getElementById("pill-entropy").classList.toggle("active", criterion === "entropy");
        document.getElementById("pill-gini").classList.toggle("active", criterion === "gini");
        document.getElementById("maxDepth").value = session.max_depth;
        document.getElementById("depthLabel").textContent = session.max_depth;
        document.getElementById("minSamples").value = session.min_samples;
        document.getElementById("minSampLabel").textContent = session.min_samples;
        document.getElementById("treeTitle").textContent = `${session.dataset_name} (loaded from cloud)`;

        // Re-render the tree (no animation — instant)
        renderD3Tree(builtTree, false);
        const stats = treeStats(builtTree);
        showStats(stats, session.stats?.nodes ?? 0);
        document.getElementById("saveSection").style.display = "flex";
        showToast(`"${session.dataset_name}" restored from history!`);
    } catch(e) {
        showToast("Failed to load tree: " + e.message, "error");
    }
}

// ── Delete a saved tree ───────────────────────────────────────
async function deleteTree(id) {
    try {
        await apiFetch(`/api/trees/${id}?session_id=${SESSION_ID}`, { method: "DELETE" });
        showToast("Tree deleted.");
        loadHistory();
    } catch(e) {
        showToast("Delete failed: " + e.message, "error");
    }
}

// ── Expose the Cloud Sync panel after first build ─────────────
// Called from showStats() inside tree.js — reveal save buttons
const _origShowStats = showStats;
function showStatsAndReveal(stats, nSamples) {
    _origShowStats(stats, nSamples);
    document.getElementById("saveSection").style.display = "flex";
}
// Override the reference used in renderD3Tree
// (showStats is called there directly; we patch it here safely)
window.showStats = function(stats, nSamples) {
    _origShowStats(stats, nSamples);
    document.getElementById("saveSection").style.display = "flex";
};
