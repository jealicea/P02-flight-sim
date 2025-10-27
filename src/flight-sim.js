import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { generateTerrain, extractTop, extractBottom, extractLeft, extractRight } from './terrain-generation.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const WING_SPAN = 11; // meters
const MAX_SPEED = 55; // m/s
const MAX_ALTITUDE = 4200; // meters
const GRAVITY = 9.81; // m/s^2
const SQUARE_SIZE = 2000; // meters
const TERRAIN_DETAIL = 8; // 2^8 + 1 = 257x257 vertices
const TERRAIN_ROUGHNESS = 0.1; // Much lower for flatter terrain

const USE_ORBIT_CONTROLS = true;
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
let manualTimeOfDay = 12; // Default to noon
let autoTimeEnabled = true;

// Ground system variables
let terrainGrid = new Map(); 
let planePosX = 0;
let planePosZ = 0;
let currentGridX = 0;
let currentGridZ = 0;

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

    // Set up orbit controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 100;
    controls.maxDistance = 6000;
    controls.maxPolarAngle = Math.PI / 2;
    controls.update();
    
    camera.position.set(0, 800, 1500);
    camera.lookAt(0, 0, 0);

    addLighting();
    createSky();
    createGround();
}

function render() {
    renderer.render(scene, camera);
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
 * Create a terrain square at the given grid coordinates
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
        color: 0x4a7c3a,
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
            const y = heightData[i][j] * 50;
            
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
 * Animate the scene
 */
function animate() {
    requestAnimationFrame(animate);

    controls.update();
    updateLighting();
    
    const time = Date.now() * 0.001;
    const radius = 3000;
    planePosX = Math.cos(time * 0.1) * radius;
    planePosZ = Math.sin(time * 0.1) * radius;

    updateTerrain();
    render();
}

/**
 * Initialize the flight simulator when the DOM is ready
 */
window.addEventListener('DOMContentLoaded', () => {
    FlightSim();
    initializeTimeControls();
    animate();
});