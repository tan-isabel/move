
// =====================================================
// MORPHSCAPE FINAL - WORKING VERSION RESTORED
// TWO HANDS = INDEX FINGERTIPS
// ONE FIST = PALM CENTRE
// ORIGINAL THREE-LAYER LUMINOUS TRAILS
// CAMERA PREVIEW ENABLED
// =====================================================

let handPose;
let video;
let hands = [];
let resetButton;
let trackingStatus;

const MS_COUNT = 16;
const MS_NEUTRAL = 90;
const MS_MIN = 5;
const MS_MAX = 180;

const msChannelForServo = [
  0, 1, 8, 9,
  2, 3, 10, 11,
  4, 5, 12, 13,
  6, 7, 14, 15
];

const msMountainUp = [
  110, 130, 125, 105,
  130, 180, 180, 125,
  125, 180, 180, 120,
  105, 125, 120, 100
];

const msMountainDown = [
  70, 50, 55, 75,
  50, 5, 5, 55,
  55, 5, 5, 60,
  75, 55, 60, 80
];

const msCoordinates = Array.from(
  { length: 16 },
  (_, i) => ({
    x: (i % 4) +
      (Math.floor(i / 4) % 2 ? 0.42 : 0),
    y: Math.floor(i / 4) * 0.92
  })
);

let msTargets = Array(MS_COUNT).fill(MS_NEUTRAL);
let msCurrent = Array(MS_COUNT).fill(MS_NEUTRAL);

let msTrails = [[], []];
let msTrailModes = ["", ""];
let msTrailPositions = [null, null];

let msMode = "READY";
let msTwoPrevious = null;
let msWideReference = null;
let msMountainDirection = 1;
let msGrip = null;
let msGrips = [null, null];
let msHandSlots = [null, null];
let msPrevGestureTime = 0;
let msLargeActivated = false;
let msLastSend = 0;

// =====================================================
// SETUP - EXPERIMENT 1E FOUNDATION
// =====================================================

async function setup() {

  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);

  bleSetup();

  resetButton = createButton("RESET");
  resetButton.id("resetButton");
  resetButton.mousePressed(msReset);

  trackingStatus = createDiv("Starting hand tracking...");
  trackingStatus.id("trackingStatus");

  try {

    handPose = await ml5.handPose();

    video = createCapture({
      video: {
        facingMode: "user"
      },
      audio: false
    });

    video.size(640, 480);
    video.hide();

    handPose.detectStart(video, gotHands);

    trackingStatus.html("Hand tracking ready");

  } catch (error) {

    console.error(
      "Hand tracking startup failed:",
      error
    );

    trackingStatus.html(
      "Camera/hand tracking error: " +
      String(error.message || error)
    );
  }
}

// =====================================================
// HANDPOSE
// =====================================================

function gotHands(results) {
  hands = results;
}

function msClamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function msKey(hand, i) {
  return hand.keypoints && hand.keypoints[i];
}

function msScreen(hand, i) {

  const p = msKey(hand, i);

  return p ? {
    x: width - map(p.x, 0, 640, 0, width),
    y: map(p.y, 0, 480, 0, height)
  } : null;
}

// =====================================================
// INDEX FINGERTIP - TWO-HAND INTERACTION
// =====================================================

function msFingertip(hand) {
  return msScreen(hand, 8);
}

// =====================================================
// PALM CENTRE - LOCALISED FIST INTERACTION
// =====================================================

function msPalmCenter(hand) {

  const points = [0, 5, 9, 13, 17]
    .map(i => msScreen(hand, i))
    .filter(Boolean);

  if (!points.length) return null;

  return {
    x: points.reduce((s, p) => s + p.x, 0) /
      points.length,
    y: points.reduce((s, p) => s + p.y, 0) /
      points.length
  };
}

// =====================================================
// FIST DETECTION
// =====================================================

function msFistScore(hand) {

  const wrist = msKey(hand, 0);

  if (!wrist) return 0;

  let folded = 0;

  for (const [tip, base] of [
    [8, 5],
    [12, 9],
    [16, 13],
    [20, 17]
  ]) {

    const t = msKey(hand, tip);
    const b = msKey(hand, base);

    if (!t || !b) continue;

    if (
      Math.hypot(t.x - wrist.x, t.y - wrist.y) <
      1.45 * Math.hypot(
        b.x - wrist.x,
        b.y - wrist.y
      )
    ) {
      folded++;
    }
  }

  return folded / 4;
}

// =====================================================
// RESET
// =====================================================

function msReset() {

  msTargets.fill(90);
  msCurrent.fill(90);

  msMode = "READY";
  msTwoPrevious = null;
  msWideReference = null;
  msMountainDirection = 1;
  msGrip = null;
  msGrips = [null, null];
  msHandSlots = [null, null];
  msPrevGestureTime = 0;
  msLargeActivated = false;

  msTrails = [[], []];
  msTrailModes = ["", ""];
  msTrailPositions = [null, null];

  sendResetCommand();
}

// =====================================================
// GESTURE INTERACTIONS
// =====================================================

// =====================================================
// STABLE HAND SLOTS (LEFT/RIGHT SCREEN POSITION)
// Keep existing hands assigned by proximity when possible.
// =====================================================
function msTrackedHands() {
  const candidates = hands.map(h => ({
    hand: h,
    fingertip: msFingertip(h),
    palm: msPalmCenter(h),
    fist: msFistScore(h)
  })).filter(h => h.palm && h.fingertip);

  if (candidates.length === 0) {
    msHandSlots = [null, null];
    return [];
  }

  if (candidates.length === 1) {
    const h = candidates[0];
    const distances = msHandSlots.map(p => p ? Math.hypot(h.palm.x-p.x,h.palm.y-p.y) : Infinity);
    const slot = distances[0] <= distances[1] ? 0 : (distances[1] < Infinity ? 1 : 0);
    msHandSlots[slot] = {x:h.palm.x,y:h.palm.y};
    msHandSlots[1-slot] = null;
    h.slot = slot;
    return [h];
  }

  const a=candidates[0], b=candidates[1];
  const distance=(h,p)=>p ? Math.hypot(h.palm.x-p.x,h.palm.y-p.y) : 0;
  const normal=distance(a,msHandSlots[0])+distance(b,msHandSlots[1]);
  const swapped=distance(a,msHandSlots[1])+distance(b,msHandSlots[0]);
  const ordered=msHandSlots[0] && msHandSlots[1]
    ? (normal<=swapped ? [a,b] : [b,a])
    : candidates.slice(0,2).sort((x,y)=>x.palm.x-y.palm.x);
  ordered.forEach((h,i)=>{
    h.slot=i;
    msHandSlots[i]={x:h.palm.x,y:h.palm.y};
  });
  return ordered;
}

// =====================================================
// GESTURE INTERACTIONS
// Two OPEN hands converging = large mountain / valley
// One or two FISTS = independent localised pulls
// =====================================================
function msUpdateGesture() {
  const detected = msTrackedHands();
  const clenched = detected.filter(h => h.fist >= 0.63);

  // FIST MODE TAKES PRIORITY, even when two hands are visible.
  if (clenched.length > 0) {
    msTwoPrevious = null;
    msWideReference = null;
    msLargeActivated = false;
    msTargets.fill(MS_NEUTRAL);

    for (let slot=0;slot<2;slot++) {
      if (!clenched.some(h=>h.slot===slot)) msGrips[slot]=null;
    }

    for (const h of clenched) {
      const slot=h.slot;
      const p=h.palm;
      if (!msGrips[slot]) {
        const px=msClamp(p.x/width,0,1)*3.42;
        const py=msClamp(p.y/height,0,1)*2.76;
        let best=0, nearest=Infinity;
        for(let i=0;i<MS_COUNT;i++) {
          const d=Math.hypot(msCoordinates[i].x-px,msCoordinates[i].y-py);
          if(d<nearest){nearest=d;best=i;}
        }
        msGrips[slot]={index:best,startY:p.y,startAngle:msCurrent[best]};
      }
      const grip=msGrips[slot];
      const travel=msClamp((grip.startY-p.y)/(height*0.05),-1,1);
      const target=msClamp(MS_NEUTRAL+travel*(travel>=0?(MS_MAX-MS_NEUTRAL):(MS_NEUTRAL-MS_MIN)),MS_MIN,MS_MAX);
      const origin=msCoordinates[grip.index];
      for(let i=0;i<MS_COUNT;i++) {
        const d=Math.hypot(msCoordinates[i].x-origin.x,msCoordinates[i].y-origin.y);
        const weight=d<0.001?1:(d<=1.16?0.5:0);
        // Combine both pulls; clamp after combining to keep servo range safe.
        msTargets[i]+=(target-MS_NEUTRAL)*weight;
      }
    }
    for(let i=0;i<MS_COUNT;i++) msTargets[i]=msClamp(msTargets[i],MS_MIN,MS_MAX);
    msMode=clenched.length===2 ? "DUAL SCULPT" : "SINGLE SCULPT";
    return;
  }

  // Neither hand is clenched.
  msGrips=[null,null];

  if(detected.length===2) {
    const a=detected[0].fingertip;
    const b=detected[1].fingertip;
    const separation=Math.hypot(a.x-b.x,a.y-b.y)/Math.max(width,height);
    const midY=(a.y+b.y)/(2*height);

    if(!msTwoPrevious) {
      msTwoPrevious={separation,midY,leftX:Math.min(a.x,b.x),rightX:Math.max(a.x,b.x)};
      msWideReference=separation;
      msLargeActivated=false;
      msTargets.fill(MS_NEUTRAL);
      msMode="READY";
      return;
    }

    const deltaSep=separation-msTwoPrevious.separation;
    const deltaY=midY-msTwoPrevious.midY;
    // Keep the established inward + vertical gesture distinction.
    // Small inward/upward motion = full mountain;
    // small inward/downward motion = full valley.
    // Once activated, hold the full profile while two hands remain open.
    const inwardX = (a.x < b.x)
      ? (msTwoPrevious.leftX !== undefined
          ? ((a.x-msTwoPrevious.leftX)+(msTwoPrevious.rightX-b.x))/width
          : 0)
      : (msTwoPrevious.leftX !== undefined
          ? ((b.x-msTwoPrevious.leftX)+(msTwoPrevious.rightX-a.x))/width
          : 0);
    if (!msLargeActivated && inwardX > 0.003 && Math.abs(deltaY) > 0.002) {
      msMountainDirection = deltaY < 0 ? 1 : -1;
      msLargeActivated = true;
    }
    const shape = msMountainDirection === 1 ? msMountainUp : msMountainDown;
    for(let i=0;i<MS_COUNT;i++) {
      msTargets[i] = msLargeActivated ? shape[i] : MS_NEUTRAL;
    }
    msTwoPrevious = {
      separation, midY,
      leftX: Math.min(a.x,b.x), rightX: Math.max(a.x,b.x)
    };
    msMode = msLargeActivated ? (msMountainDirection===1?"MOUNTAIN":"VALLEY") : "READY";
    return;
  }

  msTwoPrevious=null;
  msWideReference=null;
  msLargeActivated=false;
  msTargets.fill(MS_NEUTRAL);
  msMode="NEUTRAL";
}

// =====================================================
// ORIGINAL WORKING LUMINOUS TRAILS
// =====================================================

function msDrawTrails() {

  const now = millis();

  const detected = hands
    .map(h => ({
      fingertip: msFingertip(h),
      palm: msPalmCenter(h),
      fist: msFistScore(h)
    }))
    .filter(h => h.fingertip || h.palm);

  let positions = [];
  let modes = [];

  if (detected.length >= 2) {

    positions = detected.slice(0, 2)
      .map(h => h.fist >= 0.63 ? h.palm : h.fingertip);

    modes = detected.slice(0, 2)
      .map(h => h.fist >= 0.63 ? "PALM" : "FINGERTIP");

  } else if (
    detected.length === 1 &&
    detected[0].fist >= 0.63
  ) {

    positions = [detected[0].palm];
    modes = ["PALM"];

  } else if (detected.length === 1) {

    positions = [detected[0].fingertip];
    modes = ["FINGERTIP"];
  }

  for (let i = 0; i < 2; i++) {

    const p = positions[i] || null;
    const mode = modes[i] || "";

    if (mode !== msTrailModes[i]) {
      msTrails[i] = [];
      msTrailPositions[i] = null;
      msTrailModes[i] = mode;
    }

    if (p) {

      const old = msTrailPositions[i];

      const jump = old
        ? Math.hypot(p.x - old.x, p.y - old.y)
        : 0;

      if (
        !old ||
        jump < Math.max(width, height) * 0.22
      ) {

        const down = old && p.y - old.y > 1.5;

        const cool =
          msMode === "VALLEY" ||
          (
            (msMode === "SINGLE SCULPT" || msMode === "DUAL SCULPT") &&
            msTargets.some(v => v < 85)
          ) ||
          down;

        msTrails[i].push({
          x: p.x,
          y: p.y,
          time: now,
          cool: !!cool
        });

        msTrailPositions[i] = p;
      }
    }

    msTrails[i] = msTrails[i].filter(
      pt => now - pt.time < 900
    );

    const trail = msTrails[i];

    for (let j = 1; j < trail.length; j++) {

      const a = trail[j - 1];
      const b = trail[j];

      const fade = msClamp(
        1 - (now - b.time) / 900,
        0,
        1
      );

      const palette = b.cool
        ? [
            [69, 107, 255],
            [0, 169, 255],
            [56, 228, 245],
            [140, 255, 226]
          ]
        : [
            [255, 55, 95],
            [255, 102, 184],
            [255, 153, 77],
            [255, 230, 109]
          ];

      const rgb = palette[
        Math.floor(j / 5) % 4
      ];

      // OUTER GLOW
      stroke(rgb[0], rgb[1], rgb[2], fade * 40);
      strokeWeight(24);
      line(a.x, a.y, b.x, b.y);

      // COLOURED TRAIL
      stroke(rgb[0], rgb[1], rgb[2], fade * 110);
      strokeWeight(9);
      line(a.x, a.y, b.x, b.y);

      // BRIGHT CENTRE
      stroke(255, 245, 240, fade * 220);
      strokeWeight(2);
      line(a.x, a.y, b.x, b.y);
    }

    if (p) {
      noStroke();
      fill(255, 255, 255, 160);
      circle(p.x, p.y, 9);
    }
  }
}

// =====================================================
// DRAW
// =====================================================

function draw() {

  background(0);

  // MIRRORED CAMERA PREVIEW
  if (
    video &&
    video.elt &&
    video.elt.readyState >= 2
  ) {

    push();
    translate(width, 0);
    scale(-1, 1);

    image(video, 0, 0, width, height);

    pop();
  }

  msUpdateGesture();

  // Direct servo targets: no software smoothing.
  for (let i = 0; i < MS_COUNT; i++) {
    msCurrent[i] = msTargets[i];
  }

  msDrawTrails();
  // Grid display hidden; full-screen localised mapping remains unchanged.

  noStroke();
  fill(245);

  textAlign(CENTER, CENTER);
  textSize(15);

  text(msMode, width / 2, 45);

  // BLE SERVO ANGLE UPDATES
  const now = millis();

  if (
    bleConnected &&
    now - msLastSend >= 100
  ) {

    const channels = Array(16).fill(MS_NEUTRAL);

    for (let i = 0; i < MS_COUNT; i++) {

      channels[msChannelForServo[i]] =
        Math.round(msCurrent[i]);
    }

    sendAngles(channels);
    msLastSend = now;
  }
}

// =====================================================
// WINDOW RESIZE
// =====================================================

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}