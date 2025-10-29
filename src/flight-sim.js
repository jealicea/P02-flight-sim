import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { generateTerrain, extractTop, extractBottom, extractLeft, extractRight } from './terrain-generation.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import planeModelUrl from './images/plane.glb';

// const WING_SPAN = 11; // meters
const MAX_SPEED = 55; // m/s
const MAX_ALTITUDE = 4200; // meters
const GRAVITY = 9.81; // m/s^2
const SQUARE_SIZE = 2000; // meters
const TERRAIN_DETAIL = 8; // 2^8 + 1 = 257x257 vertices
const TERRAIN_ROUGHNESS = 0.05; // Much lower for flatter terrain

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

// Time of day controls
let manualTimeOfDay = 16; // Default to noon
let autoTimeEnabled = false;

// Ground system variables
let terrainGrid = new Map(); 
let planePosX = 0;
let planePosZ = 0;
let currentGridX = 0;
let currentGridZ = 0;

// Plane variables
let plane;
let propeller;
let planeSpeed = 0; // Current speed of the plane in m/s
let planeAltitude = 200; // Current altitude of the plane in meters
let thrust = 0.5; // Thrust as a percentage (0.0 to 1.0)

// Plane physics and orientation
let planeRotationX = 0; // Pitch
let planeRotationY = 0; // Yaw
let planeRotationZ = 0; // Roll
let velocityX = -20; // Initial velocity [−20, 0, 0] m/s
let velocityY = 0;
let velocityZ = 0;
let angularVelocityX = 0; // Pitch angular velocity (rad/s)
let angularVelocityY = 0; // Yaw angular velocity (rad/s)
let angularVelocityZ = 0; // Roll angular velocity (rad/s)

// Keyboard controls state
const keys = {
    w: false, // Pitch up
    s: false, // Pitch down
    a: false, // Roll left
    d: false, // Roll right
    q: false, // Yaw left
    e: false, // Yaw right
    shift: false, // Increase throttle
    ctrl: false, // Decrease throttle
    space: false // Brake
};

function FlightSim() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    scene.fog = new THREE.Fog(0xE6F3FF, 8000, 20000);
    renderer.setSize(window.innerWidth, window.innerHeight);

    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    const container = document.getElementById('container');
    container.appendChild(renderer.domElement);

    if (USE_ORBIT_CONTROLS) {
        // Set up orbit controls
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
        // Camera will follow the plane
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
            event.preventDefault(); // Prevent page scroll
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


function addLighting() {
    ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    // Directional light representing the sun
    directionalLight = new THREE.DirectionalLight(0xffffff, 0.1);
    // Position will be set dynamically in updateLighting()
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

function createSky() {
    sky = new Sky();
    sky.scale.setScalar(450000);

    const phi = 90 * Math.PI / 180;
    const theta = 180 * Math.PI / 180;
    const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

    sky.material.uniforms.sunPosition.value = sunPosition;

    scene.add(sky);
}


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
    
    // Update the directional light helper
    if (DEBUG && directionalLightHelper) {
        directionalLightHelper.update();
    }
    
    if (sky) {
        sky.material.uniforms.sunPosition.value = sunPosition;
    }
    
    // Calculate lighting based on sun elevation
    if (sunElevation > 0) {
        // Daytime
        const dayFactor = Math.sin(sunElevation);
        ambientLight.intensity = 0.3 + (dayFactor * 0.2);
        directionalLight.intensity = 0.1 + (dayFactor * 0.3);
        
        const brightness = 0.6 + (dayFactor * 0.15);
        ambientLight.color.setRGB(brightness * 0.9, brightness * 0.9, brightness * 0.95);
        directionalLight.color.setRGB(brightness, brightness, brightness);
        
        scene.fog.color.setRGB(0.9, 0.95, 0.98);
    } else {
        // Nighttime
        ambientLight.intensity = 0.25;
        directionalLight.intensity = 0.15;
        
        ambientLight.color.setRGB(0.4, 0.4, 0.6);
        directionalLight.color.setRGB(0.3, 0.3, 0.5);
        
        scene.fog.color.setRGB(0.15, 0.15, 0.25);
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
 * Create the initial 3x3 grid of terrain squares
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
    
    // Initialize plane physics variables according to specs
    planePosX = 0;
    planePosZ = 0;
    planeAltitude = 200;
    velocityX = -20; // Initial velocity [−20, 0, 0] m/s
    velocityY = 0;
    velocityZ = 0;
    angularVelocityX = 0; // Initial angular velocity [0, 0, 0] rad/s
    angularVelocityY = 0;
    angularVelocityZ = 0;
    planeSpeed = 20; // Initial speed
    thrust = 0.5; // Initial 50% throttle
    
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
            
            // Enable shadows for the loaded model and find the propeller
            planeModel.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
                
                // Try to find the propeller by name (common names: 'propeller', 'Propeller', 'prop', 'Prop')
                if (child.name && (
                    child.name.toLowerCase().includes('propeller') || 
                    child.name.toLowerCase().includes('prop')
                )) {
                    propeller = child;
                    console.log('Propeller found:', child.name);
                }
            });
            
            // If propeller wasn't found by name, create a custom propeller
            if (!propeller) {
                console.log('Creating custom propeller');
                createPropeller();
            }
            
            // Scale the model to match the original plane size (adjust as needed)
            planeModel.scale.set(2, 2, 2);
            
            // Rotate the model to face forward horizontally
            planeModel.rotation.x = -Math.PI / 2; // Rotate -90 degrees to make it horizontal
            
            plane.add(planeModel);
            console.log('Plane model loaded successfully');
        },
        
        // onProgress callback
        (xhr) => {
            console.log((xhr.loaded / xhr.total * 100) + '% loaded');
        },
        
        // onError callback
        (error) => {
            console.error('An error occurred loading the plane model:', error);
        }
    );
}

/**
 * Create a propeller on the nose of the plane
 */
function createPropeller() {
    // Create a group for the propeller
    propeller = new THREE.Group();
    
    // Create propeller blades
    const bladeGeometry = new THREE.BoxGeometry(0.2, 3, 0.06); // thin, long blades (smaller)
    const bladeMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x7C7C7D,
        // metalness: 0.7,
        // roughness: 0.3
    });
    
    // Create two blades
    const blade1 = new THREE.Mesh(bladeGeometry, bladeMaterial);
    blade1.castShadow = true;
    blade1.receiveShadow = true;
    propeller.add(blade1);
    
    const blade2 = new THREE.Mesh(bladeGeometry, bladeMaterial);
    blade2.rotation.z = Math.PI / 2; // Rotate 90 degrees for cross pattern
    blade2.castShadow = true;
    blade2.receiveShadow = true;
    propeller.add(blade2);
    
    // Create propeller hub (center)
    const hubGeometry = new THREE.CylinderGeometry(0.3, 0.3, 0.4, 16);
    const hubMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x7C7C7D,
        // metalness: 0.8,
        // roughness: 0.2
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
 * Create a terrain square at the givean grid coordinates
 * @param {number} gridX - The grid X coordinate
 * @param {number} gridZ - The grid Z coordinate
 */
function createTerrainSquare(gridX, gridZ) {
    const key = `${gridX},${gridZ}`;
    
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
    
    const material = new THREE.MeshLambertMaterial({ 
        color: 0x7fc96e,
        side: THREE.DoubleSide,
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
    
    // Generate vertices and UVs from height data
    for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
            const x = (j / (size - 1) - 0.5) * SQUARE_SIZE;
            const z = (i / (size - 1) - 0.5) * SQUARE_SIZE;
            const y = Math.min(Math.max(heightData[i][j] * 10, 0), 200000); // Scale down and cap at 200km
            
            vertices.push(x, y, z);
            uvs.push(j / (size - 1), i / (size - 1));
        }
    }
    
    // Generate indices for triangles
    for (let i = 0; i < size - 1; i++) {
        for (let j = 0; j < size - 1; j++) {
            const a = i * size + j;
            const b = i * size + j + 1;
            const c = (i + 1) * size + j;
            const d = (i + 1) * size + j + 1;
            
            // Create two triangles per quad
            indices.push(a, b, c);
            indices.push(b, d, c);
        }
    }
    
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    
    return geometry;
}

/**
 * Update terrain based on plane position
 * */
function updateTerrain() {
    const newGridX = Math.floor((planePosX + SQUARE_SIZE / 2) / SQUARE_SIZE);
    const newGridZ = Math.floor((planePosZ + SQUARE_SIZE / 2) / SQUARE_SIZE);
    
    if (newGridX !== currentGridX || newGridZ !== currentGridZ) {
        currentGridX = newGridX;
        currentGridZ = newGridZ;
        
        // Ensure terrain exists within 1 grid square in all directions
        for (let x = currentGridX - 1; x <= currentGridX + 1; x++) {
            for (let z = currentGridZ - 1; z <= currentGridZ + 1; z++) {
                createTerrainSquare(x, z);
            }
        }
        
        removeDistantTerrain()
    }
}

/**
 * Remove terrain squares that are more than 3 grid squares away
 */
function removeDistantTerrain() {
    const maxDistance = 3;
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
        terrain.mesh.geometry.dispose();
        terrain.mesh.material.dispose();
        terrainGrid.delete(key);
    });
}

/**
 * Update plane physics based on keyboard controls
 */
function updatePlaneControls(deltaTime) {
    // Angular velocity changes (2 rad/s^2 acceleration)
    const angularAccel = 2 * deltaTime;
    
    // W/S - Pitch down/up (effects angular velocity)
    if (keys.w) {
        angularVelocityX -= angularAccel; // Pitch up
    }
    if (keys.s) {
        angularVelocityX += angularAccel; // Pitch down
    }
    
    // A/D - Roll left/right (effects angular velocity)
    if (keys.a) {
        angularVelocityZ += angularAccel; // Roll left
    }
    if (keys.d) {
        angularVelocityZ -= angularAccel; // Roll right
    }
    
    // Q/E - Yaw left/right (effects angular velocity)
    if (keys.q) {
        angularVelocityY += angularAccel; // Yaw left
    }
    if (keys.e) {
        angularVelocityY -= angularAccel; // Yaw right
    }
    
    // Shift/Ctrl - Increase/Decrease throttle
    if (keys.shift) {
        thrust = Math.min(1.0, thrust + deltaTime);
    }
    if (keys.ctrl) {
        thrust = Math.max(0.0, thrust - deltaTime);
    }
    
    // Space - Greatly decrease throttle (by delta time times 3)
    if (keys.space) {
        thrust = Math.max(0.0, thrust - deltaTime * 3);
    }
    
    // Angular velocity dampening (multiply by 1 - 3*deltaTime, minimum 0)
    const dampeningFactor = Math.max(0, 1 - 3 * deltaTime);
    angularVelocityX *= dampeningFactor;
    angularVelocityY *= dampeningFactor;
    angularVelocityZ *= dampeningFactor;
    
    // Get the direction the plane is facing
    // The plane's forward direction needs to be calculated from its rotation
    // In Three.js, we need to create a forward vector and apply the plane's rotation
    const forward = new THREE.Vector3(1, 0, 0); // Forward is +X in our plane model
    const rotation = new THREE.Euler(planeRotationX, planeRotationY, planeRotationZ, 'XYZ');
    forward.applyEuler(rotation);
    
    // Initialize acceleration to the direction that plane is facing multiplied by throttle * 10
    let accelX = forward.x * thrust * 10;
    let accelY = forward.y * thrust * 10;
    let accelZ = forward.z * thrust * 10;
    
    // The plane's y acceleration is affected by gravity and lift
    // Subtract gravity (9.81 m/s^2)
    accelY -= GRAVITY;
    
    // Add the plane's x/z speed times 0.003 for lift
    const xzSpeed = Math.sqrt(velocityX * velocityX + velocityZ * velocityZ);
    accelY += xzSpeed * 0.003;
    
    // Compute the velocity from the acceleration
    // Acceleration is added to current velocity
    velocityX += accelX * deltaTime;
    velocityY += accelY * deltaTime;
    velocityZ += accelZ * deltaTime;
    
    // Overall velocity is multiplied by 99% to account for air resistance
    velocityX *= 0.99;
    velocityY *= 0.99;
    velocityZ *= 0.99;
    
    // Cap overall speed to maximum speed of 55 m/s
    const currentSpeed = Math.sqrt(velocityX * velocityX + velocityY * velocityY + velocityZ * velocityZ);
    if (currentSpeed > MAX_SPEED) {
        const scale = MAX_SPEED / currentSpeed;
        velocityX *= scale;
        velocityY *= scale;
        velocityZ *= scale;
    }
    
    // Update position with current velocity times delta time
    planePosX += velocityX * deltaTime;
    planeAltitude += velocityY * deltaTime;
    planePosZ += velocityZ * deltaTime;
    
    // Cap altitude at 4200 m
    planeAltitude = Math.min(MAX_ALTITUDE, Math.max(0, planeAltitude));
    
    // Rotate the aircraft by its angular velocity times delta time
    planeRotationX += angularVelocityX * deltaTime;
    planeRotationY += angularVelocityY * deltaTime;
    planeRotationZ += angularVelocityZ * deltaTime;
    
    // Update planeSpeed for display purposes
    planeSpeed = currentSpeed;
}

/**
 * Update the GUI display with current plane statistics
 */
function updateGUI() {
    // Update speed display (convert m/s to km/h)
    const speedElement = document.getElementById('speed');
    if (speedElement) {
        const speedKmh = (planeSpeed * 3.6).toFixed(1);
        speedElement.textContent = speedKmh;
    }

    // Update altitude display
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
    const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.1); // Cap at 0.1s to prevent huge jumps
    lastTime = currentTime;

    if (USE_ORBIT_CONTROLS) {
        controls.update();
    }
    updateLighting();
    
    // Update plane controls and physics
    if (deltaTime > 0) {
        updatePlaneControls(deltaTime);
    }
    
    // Update plane position and rotation
    if (plane) {
        plane.position.x = planePosX;
        plane.position.z = planePosZ;
        plane.position.y = planeAltitude;
        
        // Apply rotations with 90-degree offset to make wings horizontal
        plane.rotation.x = planeRotationX + Math.PI / 2;
        plane.rotation.y = planeRotationY;
        plane.rotation.z = planeRotationZ;
        
        // Camera follows the plane
        if (!USE_ORBIT_CONTROLS) {
            const cameraDistance = 40;
            const cameraHeight = 10;
            
            // Calculate the backward direction from the plane's orientation
            // The plane faces +X direction initially, account for yaw rotation
            const backwardX = Math.sin(planeRotationY);
            const backwardZ = -Math.cos(planeRotationY);
            
            // Position camera behind the plane
            camera.position.x = plane.position.x + backwardX * cameraDistance;
            camera.position.y = plane.position.y + cameraHeight;
            camera.position.z = plane.position.z + backwardZ * cameraDistance;
            
            // Make camera look at the plane
            camera.lookAt(plane.position);
        }
    }
    
    // Rotate propeller based on plane speed
    if (propeller) {
        // Propeller rotation speed is proportional to plane speed
        // Scale the speed to make it visually appealing (speed is in m/s)
        const propellerSpeed = planeSpeed * 2; // Adjust multiplier for visual effect
        propeller.rotation.z -= propellerSpeed * 0.01; // Spin around Z-axis (sideways rotation)
    }

    updateTerrain();
    updateGUI();
    render();
}

/**
 * Reset the plane to initial position and state
 */
function resetPlane() {
    planePosX = 0;
    planePosZ = 0;
    planeAltitude = 200;
    planeSpeed = 20; // Initial speed magnitude
    thrust = 0.5; // Initial 50% thrust
    planeRotationX = 0;
    planeRotationY = 0;
    planeRotationZ = 0;
    velocityX = -20; // Initial velocity [−20, 0, 0] m/s
    velocityY = 0;
    velocityZ = 0;
    angularVelocityX = 0; // Initial angular velocity [0, 0, 0] rad/s
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
    
    // Set up reset button
    const resetButton = document.getElementById('reset');
    if (resetButton) {
        resetButton.addEventListener('click', resetPlane);
    }
    
    animate();
});