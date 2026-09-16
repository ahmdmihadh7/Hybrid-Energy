/**
 * HYBRID RENEWABLE ENERGY MONITORING DASHBOARD
 * Core Simulation & Visualization Engine (Vanilla ES6+ JavaScript)
 * 
 * Features:
 * - Real-time simulated microgrid telemetry (Solar, Wind, Battery, Load)
 * - Dynamic Energy Management System (EMS) power dispatch logic
 * - Bi-directional BESS charge/discharge & SOC saturation (20% - 100%)
 * - Dynamic SVG vector flow diagram with directional animations
 * - Dynamic Wind Turbine speed adjustment via CSS variables
 * - Interactive Chart.js charts with theme sync (Dark/Light)
 * - Hybrid System Sizing Calculator with status evaluation
 */

// Global App State & Config
const AppState = {
  // Simulation Controls
  isPaused: false,
  simSpeedMultiplier: 1, // 1x, 2x, 5x
  timerId: null,
  updateIntervalMs: 2200,

  // Grid Carbon Intensity Factor (Assumed local thermal grid emission factor)
  gridEmissionFactorKgPerKwh: 0.82, // Explicitly defined benchmark

  // Real-time Electrical Parameters
  solar: {
    irradiance: 850, // W/m²
    voltage: 360.0,  // V DC
    current: 11.67,  // A DC
    power: 4.20,     // kW (P = V * I)
    dailyEnergy: 27.4 // kWh
  },

  wind: {
    speed: 7.2,      // m/s
    rpm: 420,        // Rotational speed
    power: 2.80,     // kW (P = 0.5 * rho * A * Cp * V^3)
    dailyEnergy: 11.2, // kWh
    status: "Generating"
  },

  load: {
    power: 5.10,     // kW
    dailyDemand: 34.8 // kWh
  },

  battery: {
    soc: 76.0,       // State of Charge %
    voltage: 48.6,   // V
    current: 8.2,    // A (+ charging, - discharging)
    temp: 31,        // °C
    capacityKwh: 10.0,
    minSoc: 20.0,    // Hard protection floor
    maxSoc: 100.0,   // Saturation ceiling
    status: "CHARGING",
    dailyThroughput: 8.4 // kWh
  },

  // Derived Values
  totalRenewablePower: 7.00,
  netBalance: 1.90, // kW (+ surplus into BESS, - deficit from BESS)
  co2AvoidedKg: 18.4,

  // Active scenario profile
  activeScenario: "balanced"
};

// Global Chart references for easy updating & theme switching
let charts = {
  solarDaily: null,
  windDaily: null,
  batteryDaily: null,
  solarVsWind: null,
  genVsLoad: null,
  batterySocAnalytics: null,
  dailyBreakdown: null
};

/* =========================================================
   INITIALIZATION ON DOM LOAD
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initNavigation();
  initSimulationControls();
  initEnergyCalculator();
  initCharts();
  startSimulationLoop();
  updateAllUIElements();
});

/* =========================================================
   THEME MANAGEMENT (DARK / LIGHT)
   ========================================================= */
function initTheme() {
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const savedTheme = localStorage.getItem("hybrid-theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);

  themeToggleBtn.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("hybrid-theme", newTheme);
    updateChartsTheme();
  });
}

function getThemeColors() {
  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  return {
    textColor: isDark ? "#94A3B8" : "#475569",
    gridColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)",
    headingColor: isDark ? "#F8FAFC" : "#0F172A",
    tooltipBg: isDark ? "#1E293B" : "#FFFFFF",
    tooltipText: isDark ? "#F8FAFC" : "#0F172A"
  };
}

/* =========================================================
   NAVIGATION & MOBILE MENU
   ========================================================= */
function initNavigation() {
  const hamburgerBtn = document.getElementById("hamburgerBtn");
  const navMenu = document.getElementById("navMenu");
  const navOverlay = document.getElementById("navOverlay");
  const navLinks = document.querySelectorAll(".nav-link");

  function closeMenu() {
    navMenu.classList.remove("open");
    if (navOverlay) navOverlay.classList.remove("open");
    hamburgerBtn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-locked");
  }

  function toggleMenu() {
    const isOpen = navMenu.classList.toggle("open");
    if (navOverlay) navOverlay.classList.toggle("open", isOpen);
    hamburgerBtn.setAttribute("aria-expanded", isOpen);
    document.body.classList.toggle("menu-locked", isOpen);
  }

  // Mobile drawer toggle
  hamburgerBtn.addEventListener("click", toggleMenu);

  if (navOverlay) {
    navOverlay.addEventListener("click", closeMenu);
  }

  // Close mobile drawer upon link click
  navLinks.forEach(link => {
    link.addEventListener("click", closeMenu);
  });

  // Close with Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && navMenu.classList.contains("open")) {
      closeMenu();
    }
  });

  // IntersectionObserver for active section highlighting in navbar
  const sections = document.querySelectorAll("section[id]");
  const observerOptions = {
    root: null,
    rootMargin: "-20% 0px -70% 0px",
    threshold: 0
  };

  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute("id");
        navLinks.forEach(link => {
          link.classList.toggle("active", link.getAttribute("href") === `#${id}`);
        });
      }
    });
  }, observerOptions);

  sections.forEach(section => sectionObserver.observe(section));
}

/* =========================================================
   SIMULATION CONTROLS & PRESET SCENARIOS
   ========================================================= */
function initSimulationControls() {
  const pauseBtn = document.getElementById("simPauseBtn");
  const speedBtn = document.getElementById("simSpeedBtn");
  const presetBtn = document.getElementById("simPresetBtn");
  const presetMenu = document.getElementById("simPresetMenu");
  const presetItems = document.querySelectorAll(".dropdown-item");

  // Toggle Pause/Resume
  pauseBtn.addEventListener("click", () => {
    AppState.isPaused = !AppState.isPaused;
    const simDot = document.getElementById("simDot");
    const simStatusText = document.getElementById("simStatusText");
    const simPauseIcon = document.getElementById("simPauseIcon");
    const simPauseLabel = document.getElementById("simPauseLabel");

    if (AppState.isPaused) {
      simDot.classList.remove("active");
      simDot.classList.add("paused");
      simStatusText.textContent = "Paused";
      simPauseIcon.textContent = "▶️";
      simPauseLabel.textContent = "Resume";
    } else {
      simDot.classList.remove("paused");
      simDot.classList.add("active");
      simStatusText.textContent = `Running (${AppState.simSpeedMultiplier}x)`;
      simPauseIcon.textContent = "⏸️";
      simPauseLabel.textContent = "Pause";
    }
  });

  // Cycle Speed (1x -> 2x -> 5x)
  speedBtn.addEventListener("click", () => {
    if (AppState.simSpeedMultiplier === 1) AppState.simSpeedMultiplier = 2;
    else if (AppState.simSpeedMultiplier === 2) AppState.simSpeedMultiplier = 5;
    else AppState.simSpeedMultiplier = 1;

    document.getElementById("simSpeedLabel").textContent = `${AppState.simSpeedMultiplier}x`;
    if (!AppState.isPaused) {
      document.getElementById("simStatusText").textContent = `Running (${AppState.simSpeedMultiplier}x)`;
    }
    resetSimulationTimer();
  });

  // Toggle Preset Dropdown
  presetBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    presetMenu.classList.toggle("show");
  });

  document.addEventListener("click", () => {
    presetMenu.classList.remove("show");
  });

  // Apply Scenarios
  presetItems.forEach(item => {
    item.addEventListener("click", (e) => {
      const preset = e.currentTarget.getAttribute("data-preset");
      applyScenarioPreset(preset);
      presetMenu.classList.remove("show");
    });
  });
}

function applyScenarioPreset(presetName) {
  AppState.activeScenario = presetName;

  switch (presetName) {
    case "noon-peak":
      AppState.solar.irradiance = 980;
      AppState.solar.voltage = 370.0;
      AppState.solar.current = 13.5;
      AppState.wind.speed = 5.8;
      AppState.load.power = 4.6;
      break;

    case "stormy-wind":
      AppState.solar.irradiance = 280;
      AppState.solar.voltage = 310.0;
      AppState.solar.current = 4.2;
      AppState.wind.speed = 12.4;
      AppState.load.power = 4.8;
      break;

    case "evening-load":
      AppState.solar.irradiance = 90;
      AppState.solar.voltage = 280.0;
      AppState.solar.current = 1.2;
      AppState.wind.speed = 6.2;
      AppState.load.power = 7.4;
      break;

    case "night-calm":
      AppState.solar.irradiance = 0;
      AppState.solar.voltage = 0;
      AppState.solar.current = 0;
      AppState.wind.speed = 2.4; // Below typical cut-in
      AppState.load.power = 5.2;
      break;

    case "balanced":
    default:
      AppState.solar.irradiance = 850;
      AppState.solar.voltage = 360.0;
      AppState.solar.current = 11.67;
      AppState.wind.speed = 7.2;
      AppState.load.power = 5.1;
      break;
  }

  // Recalculate immediate physics & redraw
  computeSystemPhysics(true);
  updateAllUIElements();
}

function resetSimulationTimer() {
  if (AppState.timerId) clearInterval(AppState.timerId);
  const interval = Math.max(500, Math.floor(AppState.updateIntervalMs / AppState.simSpeedMultiplier));
  AppState.timerId = setInterval(simulationStep, interval);
}

function startSimulationLoop() {
  resetSimulationTimer();
}

/* =========================================================
   PHYSICAL MODELING & SIMULATION STEP
   ========================================================= */
function simulationStep() {
  if (AppState.isPaused) return;

  // 1. Natural stochastic perturbations around active scenario baseline
  // Solar Jitter (simulating minor cloud haze or tracker angle variance)
  if (AppState.solar.irradiance > 0) {
    const irrJitter = (Math.random() - 0.5) * 15;
    AppState.solar.irradiance = Math.max(0, Math.min(1050, AppState.solar.irradiance + irrJitter));
    
    // PV Array I-V characteristic relationship
    const voltJitter = (Math.random() - 0.5) * 1.5;
    AppState.solar.voltage = Math.max(260, Math.min(400, AppState.solar.voltage + voltJitter));
    
    // Photocurrent is proportional to irradiance G
    AppState.solar.current = (AppState.solar.irradiance / 850) * 11.67;
  } else {
    AppState.solar.voltage = 0;
    AppState.solar.current = 0;
  }

  // Wind Speed Jitter (simulating atmospheric gusts)
  const gust = (Math.random() - 0.5) * 0.4;
  AppState.wind.speed = Math.max(0, Math.min(22, AppState.wind.speed + gust));

  // Load Demand Jitter (simulating domestic appliance switching)
  const loadJitter = (Math.random() - 0.5) * 0.18;
  AppState.load.power = Math.max(1.5, Math.min(9.5, AppState.load.power + loadJitter));

  // 2. Compute dependent physics & Energy Management System (EMS) dispatch
  computeSystemPhysics();

  // 3. Update all UI representations
  updateAllUIElements();
}

/**
 * Computes all electrical power values, wind aerodynamics,
 * battery state of charge (SOC), and carbon offset metrics.
 */
function computeSystemPhysics(isInstantPreset = false) {
  // --- Solar DC Power: P = V * I ---
  AppState.solar.power = (AppState.solar.voltage * AppState.solar.current) / 1000.0; // kW

  // --- Wind Power Aerodynamics: P = 0.5 * rho * A * Cp * V^3 ---
  const rho = 1.225; // kg/m^3 (Air density at sea level)
  const rotorRadius = 1.8; // m (Radius of 3.6m rotor diameter)
  const sweptArea = Math.PI * Math.pow(rotorRadius, 2); // m^2 ~ 10.18 m^2
  const cp = 0.42; // Betz aerodynamic coefficient (42%)
  const cutInSpeed = 3.0; // m/s
  const ratedSpeed = 11.0; // m/s
  const cutOutSpeed = 20.0; // m/s

  if (AppState.wind.speed < cutInSpeed) {
    AppState.wind.power = 0;
    AppState.wind.rpm = 0;
    AppState.wind.status = "Cut-in Standby";
  } else if (AppState.wind.speed > cutOutSpeed) {
    AppState.wind.power = 0;
    AppState.wind.rpm = 0;
    AppState.wind.status = "Cut-out Furled";
  } else {
    // Aerodynamic kinetic power converted to electrical kW (with 90% generator efficiency)
    const effectiveV = Math.min(AppState.wind.speed, ratedSpeed);
    const mechWatts = 0.5 * rho * sweptArea * cp * Math.pow(effectiveV, 3);
    AppState.wind.power = (mechWatts * 0.90) / 1000.0; // kW
    // RPM is directly proportional to wind speed (Tip Speed Ratio)
    AppState.wind.rpm = Math.round(effectiveV * 58.3);
    AppState.wind.status = "Generating";
  }

  // --- Total Renewable Generation ---
  AppState.totalRenewablePower = AppState.solar.power + AppState.wind.power;

  // --- Net Microgrid Power Balance ---
  AppState.netBalance = AppState.totalRenewablePower - AppState.load.power;

  // --- BESS Energy Management Logic ---
  const timeStepSeconds = (AppState.updateIntervalMs / 1000.0) * AppState.simSpeedMultiplier;
  const batteryCapKwh = AppState.battery.capacityKwh;

  if (AppState.netBalance > 0) {
    // RENEWABLE SURPLUS -> Battery Charges
    const chargePower = AppState.netBalance; // kW
    if (AppState.battery.soc < AppState.battery.maxSoc) {
      AppState.battery.status = "CHARGING";
      // deltaSOC = (P * deltaT / Capacity) * 100
      const deltaSoc = (chargePower * (timeStepSeconds / 3600.0) / batteryCapKwh) * 100.0;
      AppState.battery.soc = Math.min(AppState.battery.maxSoc, AppState.battery.soc + deltaSoc);
      AppState.battery.voltage = 48.0 + (AppState.battery.soc / 100.0) * 4.2; // 48.0V - 52.2V
      AppState.battery.current = (chargePower * 1000.0) / AppState.battery.voltage;
    } else {
      AppState.battery.status = "FULL (FLOAT)";
      AppState.battery.current = 0.5;
    }
  } else if (AppState.netBalance < 0) {
    // RENEWABLE DEFICIT -> Battery Discharges
    const dischargePower = Math.abs(AppState.netBalance); // kW
    if (AppState.battery.soc > AppState.battery.minSoc) {
      AppState.battery.status = "DISCHARGING";
      const deltaSoc = (dischargePower * (timeStepSeconds / 3600.0) / batteryCapKwh) * 100.0;
      AppState.battery.soc = Math.max(AppState.battery.minSoc, AppState.battery.soc - deltaSoc);
      AppState.battery.voltage = 46.0 + (AppState.battery.soc / 100.0) * 3.8;
      AppState.battery.current = -((dischargePower * 1000.0) / AppState.battery.voltage);
    } else {
      // Minimum SOC reached (20% cutoff)
      AppState.battery.status = "LOW BATTERY (SHED)";
      AppState.battery.current = 0.0;
    }
  } else {
    // Perfectly Balanced
    AppState.battery.status = "IDLE";
    AppState.battery.current = 0.0;
  }

  // Cumulative Energy Integration (Simulated increments)
  const dtHours = timeStepSeconds / 3600.0;
  AppState.solar.dailyEnergy += AppState.solar.power * dtHours;
  AppState.wind.dailyEnergy += AppState.wind.power * dtHours;
  AppState.load.dailyDemand += AppState.load.power * dtHours;

  // CO2 Avoided (kg) = Total Renewable Energy (kWh) * Grid Emission Factor (kg/kWh)
  const totalRenewableKwh = AppState.solar.dailyEnergy + AppState.wind.dailyEnergy;
  AppState.co2AvoidedKg = totalRenewableKwh * AppState.gridEmissionFactorKgPerKwh;
}

/* =========================================================
   UI RENDERING & SYNCHRONIZATION
   ========================================================= */
function updateAllUIElements() {
  updateHeroSection();
  updateKPICards();
  updateFlowDiagram();
  updateSolarSection();
  updateWindSection();
  updateBatterySection();
  updateAnalyticsSummary();
}

/**
 * Update Page 1 Hero Snapshot
 */
function updateHeroSection() {
  document.getElementById("heroTotalGen").textContent = `${AppState.totalRenewablePower.toFixed(1)} kW`;
  document.getElementById("heroLoad").textContent = `${AppState.load.power.toFixed(1)} kW`;
  document.getElementById("heroBattery").textContent = `${AppState.battery.soc.toFixed(0)}%`;

  const heroStatusBadge = document.getElementById("heroStatusBadge");
  heroStatusBadge.textContent = AppState.battery.status;
  if (AppState.battery.status.includes("CHARGING")) {
    heroStatusBadge.className = "qs-badge charging";
  } else {
    heroStatusBadge.className = "qs-badge discharging";
  }

  // Schematic Nodes
  document.getElementById("heroSolarVal").textContent = `${AppState.solar.power.toFixed(1)} kW`;
  document.getElementById("heroWindVal").textContent = `${AppState.wind.power.toFixed(1)} kW`;
  document.getElementById("heroLoadVal").textContent = `${AppState.load.power.toFixed(1)} kW`;
  document.getElementById("heroBatVal").textContent = `${AppState.battery.soc.toFixed(0)}% (${AppState.battery.status})`;

  const heroNetFlow = document.getElementById("heroNetFlow");
  const heroBatArrow = document.getElementById("heroBatArrow");

  if (AppState.netBalance >= 0) {
    heroNetFlow.textContent = `+${AppState.netBalance.toFixed(1)} kW Surplus`;
    heroNetFlow.style.color = "#10B981";
    heroBatArrow.textContent = "▲ Charging";
    heroBatArrow.style.color = "#10B981";
  } else {
    heroNetFlow.textContent = `${AppState.netBalance.toFixed(1)} kW Deficit`;
    heroNetFlow.style.color = "#F59E0B";
    heroBatArrow.textContent = "▼ Discharging";
    heroBatArrow.style.color = "#F59E0B";
  }
}

/**
 * Update Page 2 KPI Cards
 */
function updateKPICards() {
  // 1. Solar KPI
  document.getElementById("kpiSolarVal").textContent = AppState.solar.power.toFixed(1);
  document.getElementById("kpiSolarIrr").textContent = Math.round(AppState.solar.irradiance);
  document.getElementById("solarTrendBar").style.width = `${Math.min(100, (AppState.solar.power / 6.0) * 100)}%`;

  // 2. Wind KPI
  document.getElementById("kpiWindVal").textContent = AppState.wind.power.toFixed(1);
  document.getElementById("kpiWindSpd").textContent = AppState.wind.speed.toFixed(1);
  document.getElementById("windTrendBar").style.width = `${Math.min(100, (AppState.wind.power / 5.0) * 100)}%`;
  document.getElementById("windStatusTag").textContent = AppState.wind.status;

  // 3. Total Renewable KPI
  document.getElementById("kpiTotalRenewableVal").textContent = AppState.totalRenewablePower.toFixed(1);
  document.getElementById("renewTrendBar").style.width = `${Math.min(100, (AppState.totalRenewablePower / 10.0) * 100)}%`;

  // 4. Load Demand KPI
  document.getElementById("kpiLoadVal").textContent = AppState.load.power.toFixed(1);
  const netBalSign = AppState.netBalance >= 0 ? "+" : "";
  document.getElementById("kpiNetBal").textContent = `${netBalSign}${AppState.netBalance.toFixed(1)} kW`;
  document.getElementById("loadTrendBar").style.width = `${Math.min(100, (AppState.load.power / 8.0) * 100)}%`;

  // 5. Battery SOC KPI
  document.getElementById("kpiBatSOCVal").textContent = Math.round(AppState.battery.soc);
  document.getElementById("kpiBatVolt").textContent = AppState.battery.voltage.toFixed(1);
  document.getElementById("batTrendBar").style.width = `${AppState.battery.soc}%`;

  const kpiBatStatusTag = document.getElementById("kpiBatStatusTag");
  kpiBatStatusTag.textContent = AppState.battery.status;
  if (AppState.battery.status.includes("CHARGING")) {
    kpiBatStatusTag.className = "kpi-status-tag charging";
  } else if (AppState.battery.status.includes("DISCHARGING")) {
    kpiBatStatusTag.className = "kpi-status-tag discharging";
  } else {
    kpiBatStatusTag.className = "kpi-status-tag";
  }

  // 6. CO2 Avoided KPI
  document.getElementById("kpiCO2Val").textContent = AppState.co2AvoidedKg.toFixed(1);
}

/**
 * Update Central Animated Vector Flow Diagram
 */
function updateFlowDiagram() {
  // SVG Text Readouts
  document.getElementById("flowSolarText").textContent = `${AppState.solar.power.toFixed(1)} kW`;
  document.getElementById("flowWindText").textContent = `${AppState.wind.power.toFixed(1)} kW`;
  document.getElementById("flowLoadText").textContent = `${AppState.load.power.toFixed(1)} kW`;
  document.getElementById("pipeSolarLabel").textContent = `${AppState.solar.power.toFixed(1)} kW In`;
  document.getElementById("pipeWindLabel").textContent = `${AppState.wind.power.toFixed(1)} kW In`;
  document.getElementById("pipeLoadLabel").textContent = `${AppState.load.power.toFixed(1)} kW Out`;

  const flowBatteryPath = document.getElementById("flowBatteryPath");
  const flowBatText = document.getElementById("flowBatText");
  const pipeBatLabel = document.getElementById("pipeBatLabel");
  const flowEmsStatus = document.getElementById("flowEmsStatus");

  const flowLogicBanner = document.getElementById("flowLogicBanner");
  const flowLogicTitle = document.getElementById("flowLogicTitle");
  const flowLogicDesc = document.getElementById("flowLogicDesc");
  const flowLogicIcon = document.getElementById("flowLogicIcon");

  if (AppState.netBalance >= 0) {
    // SURPLUS ROUTED TO BATTERY
    flowEmsStatus.textContent = `+${AppState.netBalance.toFixed(1)} kW Excess`;
    flowEmsStatus.style.fill = "#10B981";

    flowBatText.textContent = `${Math.round(AppState.battery.soc)}% (${AppState.netBalance.toFixed(1)} kW)`;
    flowBatText.style.fill = "#10B981";

    pipeBatLabel.textContent = `▼ ${AppState.netBalance.toFixed(1)} kW Chg`;
    pipeBatLabel.style.fill = "#10B981";

    // SVG animated flow line flowing DOWN into battery
    flowBatteryPath.setAttribute("class", "flow-line battery-flow-charge active");
    flowBatteryPath.setAttribute("marker-end", "url(#arrowBatteryDown)");

    flowLogicBanner.className = "flow-logic-banner";
    flowLogicIcon.textContent = "⚡";
    flowLogicTitle.textContent = "Renewable Surplus Condition (P_gen > P_load):";
    flowLogicDesc.textContent = `Total generation (${AppState.totalRenewablePower.toFixed(1)} kW) exceeds consumer demand (${AppState.load.power.toFixed(1)} kW). Surplus power of ${AppState.netBalance.toFixed(1)} kW is actively routed into the battery storage bank.`;
  } else {
    // DEFICIT SUPPLIED BY BATTERY OR GRID
    const deficit = Math.abs(AppState.netBalance);
    flowEmsStatus.textContent = `-${deficit.toFixed(1)} kW Deficit`;
    flowEmsStatus.style.fill = "#F59E0B";

    if (AppState.battery.soc > AppState.battery.minSoc) {
      flowBatText.textContent = `${Math.round(AppState.battery.soc)}% (-${deficit.toFixed(1)} kW)`;
      flowBatText.style.fill = "#F59E0B";

      pipeBatLabel.textContent = `▲ ${deficit.toFixed(1)} kW Dis`;
      pipeBatLabel.style.fill = "#F59E0B";

      // SVG animated flow line flowing UP from battery into load
      flowBatteryPath.setAttribute("class", "flow-line battery-flow-discharge active");
      flowBatteryPath.setAttribute("marker-end", "url(#arrowBatteryUp)");

      flowLogicBanner.className = "flow-logic-banner discharge-mode";
      flowLogicIcon.textContent = "🔋";
      flowLogicTitle.textContent = "Renewable Deficit Condition (P_gen < P_load):";
      flowLogicDesc.textContent = `Total renewable generation (${AppState.totalRenewablePower.toFixed(1)} kW) is insufficient for load (${AppState.load.power.toFixed(1)} kW). The battery storage system is discharging ${deficit.toFixed(1)} kW to maintain voltage stability.`;
    } else {
      // LOW BATTERY PROTECTION
      flowBatText.textContent = `${Math.round(AppState.battery.soc)}% (Cutoff)`;
      flowBatText.style.fill = "#EF4444";

      pipeBatLabel.textContent = `⚠️ 0.0 kW Off`;
      pipeBatLabel.style.fill = "#EF4444";

      flowBatteryPath.setAttribute("class", "flow-line");
      flowBatteryPath.removeAttribute("marker-end");

      flowLogicBanner.className = "flow-logic-banner deficit-mode";
      flowLogicIcon.textContent = "⚠️";
      flowLogicTitle.textContent = "Low Battery Cutoff Limit (SOC <= 20%):";
      flowLogicDesc.textContent = `Battery has reached the minimum safe 20% Depth-of-Discharge cutoff. Discharge is locked out to protect cell chemistry; auxiliary grid backup or demand response shedding is active.`;
    }
  }
}

/**
 * Update Page 3 Solar Telemetry
 */
function updateSolarSection() {
  document.getElementById("solarIrrVal").textContent = Math.round(AppState.solar.irradiance);
  document.getElementById("solarVoltVal").textContent = AppState.solar.voltage.toFixed(1);
  document.getElementById("solarCurrVal").textContent = AppState.solar.current.toFixed(1);
  document.getElementById("solarPowerCalculated").textContent = AppState.solar.power.toFixed(2);
  document.getElementById("solarDailyEnergy").textContent = AppState.solar.dailyEnergy.toFixed(1);
}

/**
 * Update Page 4 Wind Telemetry & Animated Turbine
 */
function updateWindSection() {
  document.getElementById("windSpeedVal").textContent = AppState.wind.speed.toFixed(1);
  document.getElementById("windRpmVal").textContent = AppState.wind.rpm;
  document.getElementById("windPowerCalculated").textContent = AppState.wind.power.toFixed(2);
  document.getElementById("windDailyEnergy").textContent = AppState.wind.dailyEnergy.toFixed(1);
  document.getElementById("windStateVal").textContent = AppState.wind.status;

  // Turbine on-page visual
  document.getElementById("turbineDynamicRpm").textContent = `${AppState.wind.rpm} RPM`;
  document.getElementById("turbineDynamicStatus").textContent = AppState.wind.status;

  // Adjust turbine rotation duration dynamically in CSS
  const rotorHub = document.getElementById("rotorHub");
  if (AppState.wind.rpm > 0) {
    // 60 / RPM = seconds per revolution. Clamp between 0.3s (very fast) and 5s (slow)
    const duration = Math.max(0.35, Math.min(4.0, (60.0 / AppState.wind.rpm) * 12)).toFixed(2);
    rotorHub.style.animationPlayState = "running";
    document.documentElement.style.setProperty("--rotor-duration", `${duration}s`);
  } else {
    rotorHub.style.animationPlayState = "paused";
  }
}

/**
 * Update Page 5 Battery Telemetry & Large Visual
 */
function updateBatterySection() {
  const socRounded = Math.round(AppState.battery.soc);
  document.getElementById("batMainSOC").textContent = `${socRounded}%`;
  document.getElementById("batteryFillBar").style.height = `${socRounded}%`;

  const batMainStatus = document.getElementById("batMainStatus");
  const bessModeTag = document.getElementById("bessModeTag");
  const batStateText = document.getElementById("batStateText");
  const batStateSub = document.getElementById("batStateSub");

  if (AppState.battery.status.includes("CHARGING")) {
    batMainStatus.textContent = `CHARGING (+${AppState.netBalance.toFixed(1)} kW)`;
    bessModeTag.textContent = "CHARGING";
    bessModeTag.className = "live-tag green";
    batStateText.textContent = "CHARGING";
    batStateText.className = "m-val text-green";
    batStateSub.textContent = "Absorbing Surplus Generation";
  } else if (AppState.battery.status.includes("DISCHARGING")) {
    batMainStatus.textContent = `DISCHARGING (-${Math.abs(AppState.netBalance).toFixed(1)} kW)`;
    bessModeTag.textContent = "DISCHARGING";
    bessModeTag.className = "live-tag";
    batStateText.textContent = "DISCHARGING";
    batStateText.className = "m-val text-solar";
    batStateSub.textContent = "Supplying Load Deficit";
  } else if (AppState.battery.status.includes("LOW")) {
    batMainStatus.textContent = "LOW BATTERY (PROTECTION)";
    bessModeTag.textContent = "LOW BATTERY";
    bessModeTag.className = "live-tag";
    batStateText.textContent = "LOW SOC CUTOFF";
    batStateText.className = "m-val text-rose";
    batStateSub.textContent = "Discharge Locked at 20%";
  } else {
    batMainStatus.textContent = "IDLE / FLOAT";
    bessModeTag.textContent = "FLOAT";
    bessModeTag.className = "live-tag cyan";
    batStateText.textContent = "FLOAT";
    batStateText.className = "m-val";
    batStateSub.textContent = "Balanced State";
  }

  // Radial Gauge Track calculation
  // Circumference = 2 * PI * r = 2 * 3.14159 * 50 = 314.159
  const circumference = 314.16;
  const offset = circumference - (AppState.battery.soc / 100.0) * circumference;
  const radialFillCircle = document.getElementById("radialFillCircle");
  radialFillCircle.style.strokeDashoffset = offset;
  document.getElementById("radialBatPct").textContent = `${socRounded}%`;

  // Numeric tiles
  document.getElementById("batVoltVal").textContent = AppState.battery.voltage.toFixed(1);
  const currSign = AppState.battery.current > 0 ? "+" : "";
  document.getElementById("batCurrVal").textContent = `${currSign}${AppState.battery.current.toFixed(1)}`;
  document.getElementById("batTempVal").textContent = AppState.battery.temp;
}

/**
 * Update Page 6 Analytics Summary Statistics (Dynamically calculated via JS)
 */
function updateAnalyticsSummary() {
  const totalGenKwh = AppState.solar.dailyEnergy + AppState.wind.dailyEnergy;
  const solarContribPct = totalGenKwh > 0 ? (AppState.solar.dailyEnergy / totalGenKwh) * 100.0 : 0;
  const windContribPct = totalGenKwh > 0 ? (AppState.wind.dailyEnergy / totalGenKwh) * 100.0 : 0;
  const renewFractionPct = AppState.load.dailyDemand > 0 ? (totalGenKwh / AppState.load.dailyDemand) * 100.0 : 0;

  document.getElementById("sumTotalRenewable").textContent = `${totalGenKwh.toFixed(1)} kWh`;
  document.getElementById("sumSolarContrib").textContent = `${solarContribPct.toFixed(1)}%`;
  document.getElementById("sumWindContrib").textContent = `${windContribPct.toFixed(1)}%`;
  document.getElementById("sumBatUsage").textContent = `${AppState.battery.dailyThroughput.toFixed(1)} kWh`;
  document.getElementById("sumLoadDemand").textContent = `${AppState.load.dailyDemand.toFixed(1)} kWh`;
  document.getElementById("sumRenewContrib").textContent = `${renewFractionPct.toFixed(1)}%`;
}

/* =========================================================
   PAGE 7: INTERACTIVE ENERGY SIZING CALCULATOR
   ========================================================= */
function initEnergyCalculator() {
  const solarCapInput = document.getElementById("calcSolarCap");
  const sunHoursInput = document.getElementById("calcSunHours");
  const solarEffInput = document.getElementById("calcSolarEff");

  const windCapInput = document.getElementById("calcWindCap");
  const windHoursInput = document.getElementById("calcWindHours");

  const dailyLoadInput = document.getElementById("calcDailyLoad");
  const resetBtn = document.getElementById("calcResetBtn");

  const inputs = [solarCapInput, sunHoursInput, solarEffInput, windCapInput, windHoursInput, dailyLoadInput];

  inputs.forEach(input => {
    input.addEventListener("input", runCalculator);
  });

  resetBtn.addEventListener("click", () => {
    solarCapInput.value = 5.0;
    sunHoursInput.value = 5.5;
    solarEffInput.value = 85;
    windCapInput.value = 3.0;
    windHoursInput.value = 8.0;
    dailyLoadInput.value = 35.0;
    runCalculator();
  });

  // Run initial calculation
  runCalculator();
}

function runCalculator() {
  const solarCap = parseFloat(document.getElementById("calcSolarCap").value);
  const sunHours = parseFloat(document.getElementById("calcSunHours").value);
  const solarEffPct = parseFloat(document.getElementById("calcSolarEff").value);

  const windCap = parseFloat(document.getElementById("calcWindCap").value);
  const windHours = parseFloat(document.getElementById("calcWindHours").value);

  const dailyLoad = parseFloat(document.getElementById("calcDailyLoad").value);

  // Update slider badge labels
  document.getElementById("badgeSolarCap").textContent = `${solarCap.toFixed(1)} kW`;
  document.getElementById("badgeSunHours").textContent = `${sunHours.toFixed(1)} hrs`;
  document.getElementById("badgeSolarEff").textContent = `${solarEffPct}%`;

  document.getElementById("badgeWindCap").textContent = `${windCap.toFixed(1)} kW`;
  document.getElementById("badgeWindHours").textContent = `${windHours.toFixed(1)} hrs`;

  document.getElementById("badgeDailyLoad").textContent = `${dailyLoad.toFixed(1)} kWh`;

  // --- FORMULA CALCULATIONS ---
  // Solar Energy = Solar Capacity (kW) × Sun Hours (h) × Efficiency Factor (0.xx)
  const estimatedSolarEnergy = solarCap * sunHours * (solarEffPct / 100.0);

  // Wind Energy = Wind Capacity (kW) × Operating Hours (h)
  const estimatedWindEnergy = windCap * windHours;

  // Total Renewable Energy = Solar Energy + Wind Energy
  const totalRenewable = estimatedSolarEnergy + estimatedWindEnergy;

  // Renewable Contribution (%) = (Total Renewable / Daily Load) × 100
  const renewableContrib = dailyLoad > 0 ? (totalRenewable / dailyLoad) * 100.0 : 0;

  // Render computed outputs
  document.getElementById("calcResultSolar").textContent = `${estimatedSolarEnergy.toFixed(2)} kWh/day`;
  document.getElementById("calcResultWind").textContent = `${estimatedWindEnergy.toFixed(2)} kWh/day`;
  document.getElementById("calcResultTotal").textContent = `${totalRenewable.toFixed(2)} kWh/day`;
  document.getElementById("calcResultContrib").textContent = `${renewableContrib.toFixed(1)}%`;

  // Evaluate Energy Status Badge
  const statusBox = document.getElementById("calcStatusBox");
  const statusIcon = document.getElementById("calcStatusIcon");
  const statusTitle = document.getElementById("calcStatusTitle");
  const statusMsg = document.getElementById("calcStatusMessage");

  if (renewableContrib >= 100.0) {
    statusBox.className = "calc-status-box success";
    statusIcon.textContent = "🌟";
    statusTitle.textContent = "Renewable Energy Exceeds Daily Load";
    statusMsg.textContent = `Total renewable generation (${totalRenewable.toFixed(2)} kWh) fully covers and exceeds the daily consumption requirement (${dailyLoad.toFixed(2)} kWh). Surplus power of ${(totalRenewable - dailyLoad).toFixed(2)} kWh/day can be stored in the battery storage system or exported to the utility grid.`;
  } else if (renewableContrib >= 60.0) {
    statusBox.className = "calc-status-box warning";
    statusIcon.textContent = "⚡";
    statusTitle.textContent = "Renewable Energy Partially Meets the Load";
    statusMsg.textContent = `Renewables supply ${renewableContrib.toFixed(1)}% (${totalRenewable.toFixed(2)} kWh) of the total demand. An auxiliary energy source or grid connection is required to supply the remaining deficit of ${(dailyLoad - totalRenewable).toFixed(2)} kWh/day during low wind or overcast periods.`;
  } else {
    statusBox.className = "calc-status-box danger";
    statusIcon.textContent = "⚠️";
    statusTitle.textContent = "Significant Energy Deficit — Grid Support Required";
    statusMsg.textContent = `Renewable contribution is currently only ${renewableContrib.toFixed(1)}% (${totalRenewable.toFixed(2)} kWh), leaving an energy deficit of ${(dailyLoad - totalRenewable).toFixed(2)} kWh/day. Consider increasing solar panel or wind turbine capacity to improve microgrid self-sufficiency.`;
  }
}

/* =========================================================
   CHART.JS DATA VISUALIZATION ENGINE
   ========================================================= */
function initCharts() {
  if (typeof Chart === "undefined") {
    console.warn("Chart.js not loaded yet.");
    return;
  }

  const themeColors = getThemeColors();

  // Chart Global Defaults
  Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
  Chart.defaults.color = themeColors.textColor;
  Chart.defaults.borderColor = themeColors.gridColor;

  // 1. Solar Daily Generation Chart (Page 3)
  const ctxSolar = document.getElementById("solarDailyChart")?.getContext("2d");
  if (ctxSolar) {
    charts.solarDaily = new Chart(ctxSolar, {
      type: "line",
      data: {
        labels: ["04:00", "06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00", "20:00"],
        datasets: [{
          label: "Solar PV Output (kW)",
          data: [0.0, 0.2, 1.1, 3.0, 4.5, 4.0, 2.2, 0.3, 0.0],
          borderColor: "#F59E0B",
          backgroundColor: "rgba(245, 158, 11, 0.18)",
          fill: true,
          tension: 0.45,
          borderWidth: 3,
          pointBackgroundColor: "#F59E0B",
          pointRadius: 4
        }]
      },
      options: getCommonChartOptions("Time of Day", "Power (kW)", 0, 5.0)
    });
  }

  // 2. Wind Daily Generation Chart (Page 4)
  const ctxWind = document.getElementById("windDailyChart")?.getContext("2d");
  if (ctxWind) {
    charts.windDaily = new Chart(ctxWind, {
      type: "line",
      data: {
        labels: ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00", "24:00"],
        datasets: [{
          label: "Wind Turbine Output (kW)",
          data: [2.9, 3.2, 2.6, 1.8, 1.4, 2.1, 3.4, 3.8, 2.8],
          borderColor: "#06B6D4",
          backgroundColor: "rgba(6, 182, 212, 0.15)",
          fill: true,
          tension: 0.4,
          borderWidth: 3,
          pointBackgroundColor: "#06B6D4",
          pointRadius: 4
        }]
      },
      options: getCommonChartOptions("24-Hour Timeline", "Power (kW)", 0, 5.0)
    });
  }

  // 3. Battery Daily SOC Chart (Page 5)
  const ctxBattery = document.getElementById("batteryDailyChart")?.getContext("2d");
  if (ctxBattery) {
    charts.batteryDaily = new Chart(ctxBattery, {
      type: "line",
      data: {
        labels: ["00:00", "04:00", "08:00", "11:00", "13:00", "16:00", "19:00", "22:00", "24:00"],
        datasets: [{
          label: "Battery State of Charge (%)",
          data: [45, 32, 28, 62, 88, 96, 78, 55, 45],
          borderColor: "#10B981",
          backgroundColor: "rgba(16, 185, 129, 0.16)",
          fill: true,
          tension: 0.35,
          borderWidth: 3,
          pointBackgroundColor: "#10B981",
          pointRadius: 4
        }]
      },
      options: getCommonChartOptions("Timeline", "SOC (%)", 0, 100)
    });
  }

  // 4. Analytics Chart 1: Solar vs Wind Generation (Page 6)
  const ctxSolarVsWind = document.getElementById("chartSolarVsWind")?.getContext("2d");
  if (ctxSolarVsWind) {
    charts.solarVsWind = new Chart(ctxSolarVsWind, {
      type: "line",
      data: {
        labels: ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "24:00"],
        datasets: [
          {
            label: "Solar PV (kW)",
            data: [0.0, 0.0, 1.1, 4.5, 2.2, 0.0, 0.0],
            borderColor: "#F59E0B",
            backgroundColor: "rgba(245, 158, 11, 0.1)",
            tension: 0.4,
            borderWidth: 2.5
          },
          {
            label: "Wind Turbine (kW)",
            data: [2.9, 3.1, 2.2, 1.4, 2.4, 3.6, 2.8],
            borderColor: "#06B6D4",
            backgroundColor: "rgba(6, 182, 212, 0.1)",
            tension: 0.4,
            borderWidth: 2.5
          }
        ]
      },
      options: getCommonChartOptions("Timeline", "Power (kW)")
    });
  }

  // 5. Analytics Chart 2: Renewable Generation vs Load Demand (Page 6)
  const ctxGenVsLoad = document.getElementById("chartGenVsLoad")?.getContext("2d");
  if (ctxGenVsLoad) {
    charts.genVsLoad = new Chart(ctxGenVsLoad, {
      type: "line",
      data: {
        labels: ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "24:00"],
        datasets: [
          {
            label: "Total Renewable Gen (kW)",
            data: [2.9, 3.1, 3.3, 5.9, 4.6, 3.6, 2.8],
            borderColor: "#10B981",
            backgroundColor: "rgba(16, 185, 129, 0.15)",
            fill: true,
            tension: 0.4,
            borderWidth: 2.5
          },
          {
            label: "Customer Load Demand (kW)",
            data: [2.0, 1.8, 3.8, 4.2, 4.0, 6.8, 3.5],
            borderColor: "#EC4899",
            borderDash: [5, 5],
            tension: 0.4,
            borderWidth: 2.5
          }
        ]
      },
      options: getCommonChartOptions("Timeline", "Power (kW)")
    });
  }

  // 6. Analytics Chart 3: Battery State of Charge (Page 6)
  const ctxBatAnalytics = document.getElementById("chartBatterySOC")?.getContext("2d");
  if (ctxBatAnalytics) {
    charts.batterySocAnalytics = new Chart(ctxBatAnalytics, {
      type: "line",
      data: {
        labels: ["00:00", "04:00", "08:00", "12:00", "16:00", "20:00", "24:00"],
        datasets: [{
          label: "BESS State of Charge (%)",
          data: [45, 32, 28, 75, 96, 68, 45],
          borderColor: "#38BDF8",
          backgroundColor: "rgba(56, 189, 248, 0.15)",
          fill: true,
          tension: 0.35,
          borderWidth: 2.5
        }]
      },
      options: getCommonChartOptions("Timeline", "SOC (%)", 0, 100)
    });
  }

  // 7. Analytics Chart 4: Daily Energy Contribution Breakdown (Doughnut / Bar)
  const ctxBreakdown = document.getElementById("chartDailyBreakdown")?.getContext("2d");
  if (ctxBreakdown) {
    charts.dailyBreakdown = new Chart(ctxBreakdown, {
      type: "doughnut",
      data: {
        labels: ["Solar PV Yield (kWh)", "Wind Turbine Yield (kWh)", "Battery Throughput (kWh)"],
        datasets: [{
          data: [27.4, 11.2, 8.4],
          backgroundColor: ["#F59E0B", "#06B6D4", "#10B981"],
          borderWidth: 2,
          borderColor: themeColors.tooltipBg
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: themeColors.textColor, padding: 15 }
          },
          tooltip: {
            backgroundColor: themeColors.tooltipBg,
            titleColor: themeColors.headingColor,
            bodyColor: themeColors.tooltipText,
            borderColor: themeColors.gridColor,
            borderWidth: 1
          }
        },
        cutout: "68%"
      }
    });
  }
}

/**
 * Standard reusable chart configuration options
 */
function getCommonChartOptions(xTitle, yTitle, yMin = null, yMax = null) {
  const colors = getThemeColors();
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: colors.textColor }
      },
      tooltip: {
        backgroundColor: colors.tooltipBg,
        titleColor: colors.headingColor,
        bodyColor: colors.tooltipText,
        borderColor: colors.gridColor,
        borderWidth: 1
      }
    },
    scales: {
      x: {
        title: { display: true, text: xTitle, color: colors.textColor },
        grid: { color: colors.gridColor },
        ticks: { color: colors.textColor }
      },
      y: {
        title: { display: true, text: yTitle, color: colors.textColor },
        grid: { color: colors.gridColor },
        ticks: { color: colors.textColor }
      }
    }
  };

  if (yMin !== null) options.scales.y.min = yMin;
  if (yMax !== null) options.scales.y.max = yMax;

  return options;
}

/**
 * Update chart colors when theme toggles between Dark and Light
 */
function updateChartsTheme() {
  const colors = getThemeColors();

  Object.values(charts).forEach(chart => {
    if (!chart) return;

    if (chart.options.scales) {
      if (chart.options.scales.x) {
        chart.options.scales.x.title.color = colors.textColor;
        chart.options.scales.x.grid.color = colors.gridColor;
        chart.options.scales.x.ticks.color = colors.textColor;
      }
      if (chart.options.scales.y) {
        chart.options.scales.y.title.color = colors.textColor;
        chart.options.scales.y.grid.color = colors.gridColor;
        chart.options.scales.y.ticks.color = colors.textColor;
      }
    }

    if (chart.options.plugins?.legend?.labels) {
      chart.options.plugins.legend.labels.color = colors.textColor;
    }

    if (chart.options.plugins?.tooltip) {
      chart.options.plugins.tooltip.backgroundColor = colors.tooltipBg;
      chart.options.plugins.tooltip.titleColor = colors.headingColor;
      chart.options.plugins.tooltip.bodyColor = colors.tooltipText;
      chart.options.plugins.tooltip.borderColor = colors.gridColor;
    }

    chart.update();
  });
}
