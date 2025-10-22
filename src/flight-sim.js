import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { generateTerrain, extractTop, extractBottom, extractLeft, extractRight } from './terrain-generation.js';

const WING_SPAN = 11; // meters
const MAX_SPEED = 55; // m/s
const MAX_ALTITUDE = 4200; // meters
const GRAVITY = 9.81; // m/s^2
const SQUARE_SIZE = 2000; // meters

const USE_ORBIT_CONTROLS = false;
const DEBUG = true;

class FlightSim {

    constructor() {
        this.scene = new THREE.Scene();

        this.initLighting();
        this.initSky();
        this.initFog();
    }

    initLighting() {
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(this.ambientLight);

        this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        this.directionalLight.position.set(100, 200, 100);
        this.scene.add(this.directionalLight);
        this.directionalLight.castShadow = true;
        this.scene.add(this.directionalLight.target);
    }

    initSky() {
        const sky = new Sky();
        sky.scale.setScalar( 450000 );

        const phi = Math.degToRad( 90 );
        const theta = Math.degToRad( 180 );
        const sunPosition = new THREE.Vector3().setFromSphericalCoords( 1, phi, theta );

        sky.material.uniforms.sunPosition.value = sunPosition;

        this.scene.add( sky );
    }

    initFog() {

    }
}

export { FlightSim };
