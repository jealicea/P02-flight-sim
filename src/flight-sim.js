import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { generateTerrain, extractTop, extractBottom, extractLeft, extractRight } from './terrain-generation.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import planeModelUrl from './images/plane.glb';

const MAX_SPEED = 55; // m/s
const MAX_ALTITUDE = 4200; // meters
const GRAVITY = 9.81; // m/s^2
const SQUARE_SIZE = 2000; // meters~
const TERRAIN_DETAIL = 9;
const TERRAIN_ROUGHNESS = 0.05;
const USE_ORBIT_CONTROLS = false;
const DEBUG = true;

let scene;
let camera;
let renderer;
let controls;
let ambientLight;
let directionalLight;
let directionalLightHelper;
let sky;

let manualTimeOfDay = 16;
let autoTimeEnabled = true;

let terrainGrid = new Map(); 
let planePosX = 0;
let planePosZ = 0;
let currentGridX = 0;
let currentGridZ = 0;
let plane;
let propeller;
let planeSpeed = 0; 
let planeAltitude = 200;
let thrust = 0.5;

// Plane physics and orientation
let planeRotationX = 0;
let planeRotationY = 0;
let planeRotationZ = 0;
let velocityX = -20;
let velocityY = 0;
let velocityZ = 0;
let angularVelocityX = 0;
let angularVelocityY = 0;
let angularVelocityZ = 0;

// Reusable objects to avoid allocations during collision checks
let _collisionBox = new THREE.Box3();
let _raycaster = new THREE.Raycaster();
_raycaster.far = 20000;

const keys = {
    w: false,
    s: false,
    a: false,
    d: false,
    q: false,
    e: false,
    shift: false,
    ctrl: false,
    space: false
};

/**
 * Initialize the flight simulator
 */
function FlightSim() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    scene.fog = new THREE.Fog(0xE6F3FF, 2000, 12000);
    renderer.setSize(window.innerWidth, window.innerHeight);

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    const container = document.getElementById('container');
    container.appendChild(renderer.domElement);

    if (USE_ORBIT_CONTROLS) {
        controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 200, 0);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.screenSpacePanning = false;
        controls.minDistance = 10;
        controls.maxDistance = 5000;
        controls.maxPolarAngle = Math.PI / 2;
        controls.update();
        
        camera.position.set(0, 200, 1500);
        camera.lookAt(0, 200, 0);
    } else {
        camera.position.set(0, 800, 1500);
    }

    addLighting();
    createSky();
    createGround();
    createPlane();
    setupKeyboardControls();
}

function render() {
    renderer.render(scene, camera);
}

/**
 * Set up keyboard event listeners for plane controls
 */
function setupKeyboardControls() {
    window.addEventListener('keydown', (event) => {
        const key = event.key.toLowerCase();
        
        if (key === 'w') keys.w = true;
        if (key === 's') keys.s = true;
        if (key === 'a') keys.a = true;
        if (key === 'd') keys.d = true;
        if (key === 'q') keys.q = true;
        if (key === 'e') keys.e = true;
        if (event.shiftKey) keys.shift = true;
        if (event.ctrlKey || event.metaKey) keys.ctrl = true;
        if (key === ' ') {
            keys.space = true;
            event.preventDefault();
        }
    });
    
    window.addEventListener('keyup', (event) => {
        const key = event.key.toLowerCase();
        
        if (key === 'w') keys.w = false;
        if (key === 's') keys.s = false;
        if (key === 'a') keys.a = false;
        if (key === 'd') keys.d = false;
        if (key === 'q') keys.q = false;
        if (key === 'e') keys.e = false;
        if (!event.shiftKey) keys.shift = false;
        if (!event.ctrlKey && !event.metaKey) keys.ctrl = false;
        if (key === ' ') keys.space = false;
    });
}

/**
 * Add ambient and directional lighting to the scene
 */
function addLighting() {
    ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 4096;
    directionalLight.shadow.mapSize.height = 4096;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 10000;
    directionalLight.shadow.camera.left = -5000;
    directionalLight.shadow.camera.right = 5000;
    directionalLight.shadow.camera.top = 5000;
    directionalLight.shadow.camera.bottom = -5000;
    directionalLight.shadow.bias = -0.0001;
    
    scene.add(directionalLight);
    scene.add(directionalLight.target);

    // Add directional light helper to visualize the sun's position and direction
    if (DEBUG) {
        directionalLightHelper = new THREE.DirectionalLightHelper(directionalLight, 1000, 0xffff00);
        scene.add(directionalLightHelper);
    }
}

/**
 * Create the sky using Three.js Sky shader
 */
function createSky() {
    sky = new Sky();
    sky.scale.setScalar(450000);

    const phi = 90 * Math.PI / 180;
    const theta = 180 * Math.PI / 180;
    const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

    sky.material.uniforms.sunPosition.value = sunPosition;
    scene.add(sky);
}

/**
 * Update lighting based on time of day
 */
function updateLighting() {
    let normalizedTime;
    
    if (autoTimeEnabled) {
        // Auto cycle - original behavior
        const cycleTime = (Date.now() * 0.001) % 60;
        normalizedTime = cycleTime / 60;
        
        // Update the slider to reflect auto time
        const timeSlider = document.getElementById('time-slider');
        if (timeSlider) {
            manualTimeOfDay = normalizedTime * 24;
            timeSlider.value = manualTimeOfDay;
            updateTimeDisplay();
        }
    } else {
        normalizedTime = manualTimeOfDay / 24;
    }
    
    const sunAngle = (normalizedTime * 2 * Math.PI) - Math.PI;
    const sunElevation = Math.sin(sunAngle) * Math.PI / 2;
    const sunDistance = 5000;
    
    const phi = Math.PI / 2 - sunElevation;
    const theta = sunAngle + Math.PI;
    const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    
    directionalLight.position.set(
        sunPosition.x * sunDistance,
        sunPosition.y * sunDistance,
        sunPosition.z * sunDistance
    );
    
    if (DEBUG && directionalLightHelper) {
        directionalLightHelper.update();
    }
    
    if (sky) {
        sky.material.uniforms.sunPosition.value = sunPosition;
    }
    
    // Calculate lighting based on sun elevation
    if (sunElevation > 0) {
        const dayFactor = Math.sin(sunElevation);
        ambientLight.intensity = 0.3 + (dayFactor * 0.2);
        directionalLight.intensity = 0.1 + (dayFactor * 0.3);
        
        const brightness = 0.6 + (dayFactor * 0.15);
        ambientLight.color.setRGB(brightness * 0.9, brightness * 0.9, brightness * 0.95);
        directionalLight.color.setRGB(brightness, brightness, brightness);
        
        scene.fog.color.setRGB(0.85, 0.9, 0.95);
    } else {
        ambientLight.intensity = 0.25;
        directionalLight.intensity = 0.15;
        
        ambientLight.color.setRGB(0.4, 0.4, 0.6);
        directionalLight.color.setRGB(0.3, 0.3, 0.5);
        
        scene.fog.color.setRGB(0.1, 0.1, 0.2);
    }
}

/**
 * Update the displayed time based on manualTimeOfDay
 */
function updateTimeDisplay() {
    const hours = Math.floor(manualTimeOfDay);
    const minutes = Math.floor((manualTimeOfDay - hours) * 60);
    const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    
    const timeDisplay = document.getElementById('time-display');
    if (timeDisplay) {
        timeDisplay.textContent = timeString;
    }
}

/**
 * Initialize time controls (slider and checkbox)
 */
function initializeTimeControls() {
    const timeSlider = document.getElementById('time-slider');
    const autoTimeCheckbox = document.getElementById('auto-time-checkbox');
    
    if (timeSlider) {
        timeSlider.addEventListener('input', (event) => {
            manualTimeOfDay = parseFloat(event.target.value);
            updateTimeDisplay();
        });
        updateTimeDisplay();
    }
    
    if (autoTimeCheckbox) {
        autoTimeCheckbox.addEventListener('change', (event) => {
            autoTimeEnabled = event.target.checked;
        });
    }
}

/**
 * Create the initial grid of terrain squares for infinite terrain
 * Starts with a 5x5 grid centered at the origin to provide good initial coverage
 */
function createGround() {
    // Initialize a 3x3 grid of terrain squares centered at origin
    for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
            createTerrainSquare(x, z);
        }
    }
}

/**
 * Create a plane - loads from .glb model file
 * Falls back to procedural geometry if model fails to load
 */
function createPlane() {
    plane = new THREE.Group();
    
    planePosX = 0;
    planePosZ = 0;
    planeAltitude = 200;
    velocityX = -20;
    velocityY = 0;
    velocityZ = 0;
    angularVelocityX = 0;
    angularVelocityY = 0;
    angularVelocityZ = 0;
    planeSpeed = 20;
    thrust = 0.5;
    
    // Position the plane at 200m altitude at the origin
    plane.position.set(0, 200, 0);
    scene.add(plane);
    
    // Load the .glb model
    const loader = new GLTFLoader();
    
    loader.load(
        planeModelUrl,
        // onLoad callback
        (gltf) => {
            const planeModel = gltf.scene;

            planeModel.traverse((obj) => {
                if (obj.isMesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;
                    if (obj.material && obj.material.isMeshBasicMaterial) {
                        obj.material = new THREE.MeshStandardMaterial({
                            map: obj.material.map || null,
                            color: obj.material.color ? obj.material.color : new THREE.Color(0xffffff),
                            metalness: 0.1,
                            roughness: 0.8
                        });
                    }
                }
            });

            createPropeller();
            planeModel.scale.set(2, 2, 2);
            planeModel.rotation.x = -Math.PI / 2;
            plane.add(planeModel);
        },
    );
}

/**
 * Create a propeller on the nose of the plane
 */
function createPropeller() {
    // Create a group for the propeller
    propeller = new THREE.Group();
    
    // Create propeller blades
    const bladeGeometry = new THREE.BoxGeometry(0.3, 4, 0.06);
    const bladeMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xffffff,
        metalness: 0.2,
        roughness: 0.3
    });
    
    // Create two blades
    const blade1 = new THREE.Mesh(bladeGeometry, bladeMaterial);
    blade1.castShadow = true;
    blade1.receiveShadow = true;
    propeller.add(blade1);
    
    const blade2 = new THREE.Mesh(bladeGeometry, bladeMaterial);
    blade2.rotation.z = Math.PI / 2;
    blade2.castShadow = true;
    blade2.receiveShadow = true;
    propeller.add(blade2);
    
    // Create propeller hub (center)
    const hubGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.4, 16);
    const hubMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xffffff,
        metalness: 0.8,
        roughness: 0.2
    });
    const hub = new THREE.Mesh(hubGeometry, hubMaterial);
    hub.rotation.x = Math.PI / 2;
    hub.castShadow = true;
    hub.receiveShadow = true;
    propeller.add(hub);
    propeller.position.set(0, 5, 0);
    propeller.rotation.x = Math.PI / 2;
    plane.add(propeller);
}

/**
 * Create a terrain square at the given grid coordinates
 * This is the core of the infinite terrain system - it generates seamless terrain
 * by matching edges with neighboring chunks using the diamond-square algorithm
 * 
 * @param {number} gridX - The grid X coordinate (can be any integer)
 * @param {number} gridZ - The grid Z coordinate (can be any integer)
 */
function createTerrainSquare(gridX, gridZ) {
    const key = `${gridX},${gridZ}`;
    
    // Skip if this terrain chunk already exists
    if (terrainGrid.has(key)) {
        return;
    }

    // Get edge constraints from neighboring squares
    const topEdge = `${gridX},${gridZ - 1}`; 
    const bottomEdge = `${gridX},${gridZ + 1}`;
    const leftEdge = `${gridX - 1},${gridZ}`;
    const rightEdge = `${gridX + 1},${gridZ}`;
    
    const constraints = {
        top: null,
        bottom: null,
        left: null,
        right: null
    };
    
    if (terrainGrid.has(topEdge)) {
        const topNeighbor = terrainGrid.get(topEdge);
        constraints.top = extractBottom(topNeighbor.heightData);
    }
    if (terrainGrid.has(bottomEdge)) {
        const bottomNeighbor = terrainGrid.get(bottomEdge);
        constraints.bottom = extractTop(bottomNeighbor.heightData);
    }
    if (terrainGrid.has(leftEdge)) {
        const leftNeighbor = terrainGrid.get(leftEdge);
        constraints.left = extractRight(leftNeighbor.heightData);
    }
    if (terrainGrid.has(rightEdge)) {
        const rightNeighbor = terrainGrid.get(rightEdge);
        constraints.right = extractLeft(rightNeighbor.heightData);
    }

    // Generate terrain height data using diamond-square algorithm
    const heightData = generateTerrain(TERRAIN_DETAIL, TERRAIN_ROUGHNESS, constraints);
    
    const geometry = createTerrainGeometry(heightData);
    
    const material = new THREE.MeshStandardMaterial({ 
        color: 0x7fc96e,
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0.0,
        vertexColors: true,
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.x = gridX * SQUARE_SIZE;
    mesh.position.z = gridZ * SQUARE_SIZE;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    
    terrainGrid.set(key, {
        mesh: mesh,
        heightData: heightData,
        gridX: gridX,
        gridZ: gridZ
    });
    
    scene.add(mesh);
}

/**
 * Create the terrain geometry from height data
 * @param {*} heightData 
 * @returns 
 */
function createTerrainGeometry(heightData) {
    const size = heightData.length;
    const geometry = new THREE.BufferGeometry();
    
    const vertices = [];
    const indices = [];
    const uvs = [];
    const colors = [];
    
    // Base green color components (matching 0x7fc96e)
    const baseColor = new THREE.Color(0x7fc96e);
    
    // Generate vertices, UVs, and colors from height data
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            const x = (j / (size - 1) - 0.5) * SQUARE_SIZE;
            const z = (i / (size - 1) - 0.5) * SQUARE_SIZE;
            const height = heightData[i][j];
            const y = Math.min(Math.max(height * 10, 0), 200000); // Scale down and cap at 200km
            
            vertices.push(x, y, z);
            uvs.push(j / (size - 1), i / (size - 1));
            
            // Calculate slope for this vertex by looking at neighbors
            let slope = 0;
            if (i > 0 && i < size - 1 && j > 0 && j < size - 1) {
                const dx = heightData[i][j + 1] - heightData[i][j - 1];
                const dz = heightData[i + 1][j] - heightData[i - 1][j];
                slope = Math.sqrt(dx * dx + dz * dz);
            }
            
            // Create color variations based on height and slope
            let colorVariation = baseColor.clone();
            
            // Height-based variation (darker for lower areas, lighter for higher)
            const heightFactor = Math.max(0, Math.min(1, (height + 5) / 15)); // Normalize height
            
            // Slope-based variation (different shades for steep vs flat areas)
            const slopeFactor = Math.min(1, slope * 2);
            
            // Add subtle random variation for texture detail
            const randomFactor = (Math.random() - 0.5) * 0.1;
            
            // Apply variations while keeping the green color scheme
            colorVariation.r = Math.max(0.3, Math.min(1, baseColor.r + (heightFactor - 0.5) * 0.2 + slopeFactor * 0.15 + randomFactor));
            colorVariation.g = Math.max(0.5, Math.min(1, baseColor.g + (heightFactor - 0.5) * 0.15 + slopeFactor * 0.1 + randomFactor));
            colorVariation.b = Math.max(0.2, Math.min(1, baseColor.b + (heightFactor - 0.5) * 0.25 + slopeFactor * 0.2 + randomFactor));
            
            colors.push(colorVariation.r, colorVariation.g, colorVariation.b);
        }
    }
    
    // Generate indices for triangles
    for (let i = 0; i < size - 1; i++) {
        for (let j = 0; j < size - 1; j++) {
            const a = i * size + j;
            const b = i * size + j + 1;
            const c = (i + 1) * size + j;
            const d = (i + 1) * size + j + 1;
            
            indices.push(a, b, c);
            indices.push(b, d, c);
        }
    }
    
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    
    return geometry;
}

/**
 * Update terrain based on plane position
 * Implements infinite terrain generation by creating new chunks as the plane moves
 * and removing distant chunks to maintain performance
 * */
function updateTerrain() {
    const newGridX = Math.floor((planePosX + SQUARE_SIZE / 2) / SQUARE_SIZE);
    const newGridZ = Math.floor((planePosZ + SQUARE_SIZE / 2) / SQUARE_SIZE);
    
    if (newGridX !== currentGridX || newGridZ !== currentGridZ) {
        currentGridX = newGridX;
        currentGridZ = newGridZ;

        for (let x = currentGridX - 2; x <= currentGridX + 2; x++) {
            for (let z = currentGridZ - 2; z <= currentGridZ + 2; z++) {
                createTerrainSquare(x, z);
            }
        }
        removeDistantTerrain();
    }
}

/**
 * Interpolate terrain height at world coordinates (x, z) in meters.
 * Uses the generated heightData for the terrain chunk under the point.
 * Returns world Y (meters).
 * NOTE: Does not allocate new vectors/arrays during the call.
 */
function getTerrainHeightAt(worldX, worldZ) {
    // Determine which grid square this point falls into
    const gridX = Math.floor((worldX + SQUARE_SIZE / 2) / SQUARE_SIZE);
    const gridZ = Math.floor((worldZ + SQUARE_SIZE / 2) / SQUARE_SIZE);
    const key = `${gridX},${gridZ}`;

    const terrain = terrainGrid.get(key);
    if (!terrain) return 0; // no terrain yet, assume sea level

    const heightData = terrain.heightData;
    const size = heightData.length;

    // Local coordinates within the square [-SQUARE_SIZE/2, SQUARE_SIZE/2]
    const localX = worldX - (gridX * SQUARE_SIZE);
    const localZ = worldZ - (gridZ * SQUARE_SIZE);

    // Convert to heightData indices (u,v) in [0, size-1]
    const u = (localX / SQUARE_SIZE + 0.5) * (size - 1);
    const v = (localZ / SQUARE_SIZE + 0.5) * (size - 1);

    // Bilinear interpolation without allocations
    const iu = Math.floor(u);
    const iv = Math.floor(v);
    const fu = u - iu;
    const fv = v - iv;

    const iu1 = Math.min(iu + 1, size - 1);
    const iv1 = Math.min(iv + 1, size - 1);

    const h00 = heightData[iv][iu];
    const h10 = heightData[iv][iu1];
    const h01 = heightData[iv1][iu];
    const h11 = heightData[iv1][iu1];

    const hx0 = h00 * (1 - fu) + h10 * fu;
    const hx1 = h01 * (1 - fu) + h11 * fu;
    const h = hx0 * (1 - fv) + hx1 * fv;

    // In createTerrainGeometry heights were scaled by *10 and clamped; match that
    return Math.min(Math.max(h * 10, 0), 200000);
}

/**
 * Check for potential and accurate collisions between plane and terrain.
 * Implements two-stage detection described in the spec. Does not allocate
 * vectors during checks beyond the preallocated scratch objects above.
 */
function checkCollisions() {
    if (!plane) return false;

    _collisionBox.setFromObject(plane);

    const expand = 2.0;
    _collisionBox.min.x -= expand;
    _collisionBox.min.z -= expand;
    _collisionBox.max.x += expand;
    _collisionBox.max.z += expand;

    const xs = [_collisionBox.min.x, (_collisionBox.min.x + _collisionBox.max.x) * 0.5, _collisionBox.max.x];
    const zs = [_collisionBox.min.z, (_collisionBox.min.z + _collisionBox.max.z) * 0.5, _collisionBox.max.z];

    let maxTerrainY = -Infinity;
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            const ty = getTerrainHeightAt(xs[i], zs[j]);
            if (ty > maxTerrainY) maxTerrainY = ty;
        }
    }
    if (maxTerrainY <= _collisionBox.min.y) {
        return false;
    }

    const cols = 6, rows = 6;
    const dx = (_collisionBox.max.x - _collisionBox.min.x) / (cols - 1);
    const dz = (_collisionBox.max.z - _collisionBox.min.z) / (rows - 1);

    const planeBottomY = _collisionBox.min.y;

    for (let ix = 0; ix < cols; ix++) {
        const sampleX = _collisionBox.min.x + dx * ix;
        for (let iz = 0; iz < rows; iz++) {
            const sampleZ = _collisionBox.min.z + dz * iz;
            const ty = getTerrainHeightAt(sampleX, sampleZ);

            if (planeBottomY < ty) {
                return true;
            }
            if ((ty - planeBottomY) <= 0.75) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Remove terrain squares that are more than the specified distance away
 * This is crucial for infinite terrain as it prevents memory leaks by
 * disposing of meshes and geometry that are no longer visible
 */
function removeDistantTerrain() {
    const maxDistance = 4;
    const toRemove = [];
    
    terrainGrid.forEach((terrain, key) => {
        const distance = Math.max(
            Math.abs(terrain.gridX - currentGridX),
            Math.abs(terrain.gridZ - currentGridZ)
        );
        
        if (distance > maxDistance) {
            toRemove.push(key);
        }
    });
    
    toRemove.forEach(key => {
        const terrain = terrainGrid.get(key);
        scene.remove(terrain.mesh);
        
        // Properly dispose of geometry and material to free memory
        if (terrain.mesh.geometry) {
            terrain.mesh.geometry.dispose();
        }
        terrainGrid.delete(key);
    });
}

/**
 * Update plane physics based on keyboard controls
 */
function updatePlaneControls(deltaTime) {
    const angularAccel = 2 * deltaTime;
    
    if (keys.w) {
        angularVelocityX -= angularAccel;
    }
    if (keys.s) {
        angularVelocityX += angularAccel;
    }
    
    if (keys.a) {
        angularVelocityZ -= angularAccel;
    }
    if (keys.d) {
        angularVelocityZ += angularAccel;
    }

    if (keys.q) {
        angularVelocityY -= angularAccel;
    }
    if (keys.e) {
        angularVelocityY += angularAccel;
    }
    
    if (keys.shift) {
        thrust = Math.min(1.0, thrust + deltaTime);
    }
    if (keys.ctrl) {
        thrust = Math.max(0.0, thrust - deltaTime);
    }
    if (keys.space) {
        thrust = Math.max(0.0, thrust - deltaTime * 3);
    }
    
    const dampeningFactor = Math.max(0, 1 - 3 * deltaTime);
    angularVelocityX *= dampeningFactor;
    angularVelocityY *= dampeningFactor;
    angularVelocityZ *= dampeningFactor;

    const forward = new THREE.Vector3(0, 0, 1);
    const rotation = new THREE.Euler(planeRotationX, planeRotationY, planeRotationZ, 'XYZ');
    forward.applyEuler(rotation);
    
    let accelX = forward.x * thrust * 100;
    let accelY = forward.y * thrust * 100;
    let accelZ = forward.z * thrust * 100;
    
    accelY -= GRAVITY;
    
    const xzSpeed = Math.sqrt(velocityX * velocityX + velocityZ * velocityZ);
    accelY += xzSpeed * 0.003;

    velocityX += accelX * deltaTime;
    velocityY += accelY * deltaTime;
    velocityZ += accelZ * deltaTime;
    
    velocityX *= 0.99;
    velocityY *= 0.99;
    velocityZ *= 0.99;
    
    const currentSpeed = Math.sqrt(velocityX * velocityX + velocityY * velocityY + velocityZ * velocityZ);
    if (currentSpeed > MAX_SPEED) {
        const scale = MAX_SPEED / currentSpeed;
        velocityX *= scale;
        velocityY *= scale;
        velocityZ *= scale;
    }
    
    planePosX += velocityX * deltaTime;
    planeAltitude += velocityY * deltaTime;
    planePosZ += velocityZ * deltaTime;
    
    planeAltitude = Math.min(MAX_ALTITUDE, Math.max(0, planeAltitude));
    
    planeRotationX += angularVelocityX * deltaTime;
    planeRotationY += angularVelocityY * deltaTime;
    planeRotationZ += angularVelocityZ * deltaTime;
    
    planeSpeed = currentSpeed;
}

/**
 * Update the GUI display with current plane statistics
 */
function updateGUI() {
    const speedElement = document.getElementById('speed');
    if (speedElement) {
        const speedKmh = (planeSpeed * 3.6).toFixed(1);
        speedElement.textContent = speedKmh;
    }
    const altitudeElement = document.getElementById('altitude');
    if (altitudeElement) {
        altitudeElement.textContent = planeAltitude.toFixed(1);
    }
}

/**
 * Animate the scene
 */
let lastTime = 0;
function animate(currentTime) {
    requestAnimationFrame(animate);

    // Calculate delta time in seconds
    const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.1);
    lastTime = currentTime;

    if (USE_ORBIT_CONTROLS) {
        controls.update();
    }
    updateLighting();
    
    if (deltaTime > 0) {
        updatePlaneControls(deltaTime);
    }

    if (plane) {
        plane.position.x = planePosX;
        plane.position.z = planePosZ;
        plane.position.y = planeAltitude;

        plane.rotation.x = planeRotationX + Math.PI / 2;
        plane.rotation.y = planeRotationY;
        plane.rotation.z = planeRotationZ;
        
        // Camera follows the plane
        if (!USE_ORBIT_CONTROLS) {
            const cameraDistance = 40;
            const cameraHeight = 10;
            const backwardX = Math.sin(planeRotationY);
            const backwardZ = -Math.cos(planeRotationY);
    
            // Position camera behind the plane
            camera.position.x = plane.position.x + backwardX * cameraDistance;
            camera.position.y = plane.position.y + cameraHeight;
            camera.position.z = plane.position.z + backwardZ * cameraDistance;
            
            camera.lookAt(plane.position);
        }
    }
    if (propeller) {
        const propellerSpeed = planeSpeed * 2;
        propeller.rotation.z -= propellerSpeed * 0.01;
    }

    updateTerrain();
    updateGUI();

    const collided = checkCollisions();
    if (collided) {
        thrust = 0;
        velocityX = 0;
        velocityY = 0;
        velocityZ = 0;
        planeSpeed = 0;
        const groundY = getTerrainHeightAt(plane.position.x, plane.position.z);
        plane.position.y = Math.max(plane.position.y, groundY);
        planeAltitude = plane.position.y;
    }
    render();
}

/**
 * Reset the plane to initial position and state
 */
function resetPlane() {
    planePosX = 0;
    planePosZ = 0;
    planeAltitude = 200;
    planeSpeed = 20;
    thrust = 0.5;
    planeRotationX = 0;
    planeRotationY = 0;
    planeRotationZ = 0;
    velocityX = -20;
    velocityY = 0;
    velocityZ = 0;
    angularVelocityX = 0;
    angularVelocityY = 0;
    angularVelocityZ = 0;
    
    if (plane) {
        plane.position.set(0, 200, 0);
        plane.rotation.set(0, 0, 0);
    }
}

/**
 * Initialize the flight simulator when the DOM is ready
 */
window.addEventListener('DOMContentLoaded', () => {
    FlightSim();
    initializeTimeControls();
    
    const resetButton = document.getElementById('reset');
    if (resetButton) {
        resetButton.addEventListener('click', resetPlane);
    }
    animate();
});