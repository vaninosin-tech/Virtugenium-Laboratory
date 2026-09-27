import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
for (const [file, name] of [['LabTray_Metal','Tray_Body'], ['LabTestTubeRack','LabTestTubeRack']]) {
 const bytes=fs.readFileSync(`public/assets/models/${file}.glb`);
 const asset=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const root=asset.scene.getObjectByName(name) ?? asset.scene;
 const box=new THREE.Box3().setFromObject(root);
 console.log(file,box.min.toArray(),box.max.toArray());
}
