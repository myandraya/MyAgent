"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { StarPoint } from "../lib/types.ts";

export function LampPreview({ stars, size, lit }: { stars: StarPoint[]; size: number; lit: boolean }) {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    const width = host.clientWidth || 420;
    const height = 330;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, -55, 390);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    host.appendChild(renderer.domElement);

    const group = new THREE.Group();
    group.rotation.x = -0.15;
    scene.add(group);
    const panel = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.43, size * 0.43, 8, 96), new THREE.MeshStandardMaterial({ color: lit ? 0x8a552f : 0x3b271b, roughness: 0.72, metalness: 0.03 }));
    panel.rotation.x = Math.PI / 2;
    group.add(panel);
    const starGeometry = new THREE.SphereGeometry(1.7, 10, 10);
    const starMaterial = new THREE.MeshBasicMaterial({ color: lit ? 0xffe7a5 : 0x111111 });
    for (const star of stars.slice(0, 70)) {
      const dot = new THREE.Mesh(starGeometry, starMaterial);
      dot.position.set((star.x - size / 2) * 0.86, (size / 2 - star.y) * 0.86, 6);
      group.add(dot);
    }
    scene.add(new THREE.AmbientLight(0xffffff, lit ? 1.2 : 1.8));
    const glow = new THREE.PointLight(0xffb84f, lit ? 18000 : 0, 600);
    glow.position.set(0, 0, 90);
    scene.add(glow);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dragging=false,last={x:0,y:0};
    const canvas=renderer.domElement;
    canvas.style.cursor="grab";
    const down=(event:PointerEvent)=>{dragging=true;last={x:event.clientX,y:event.clientY};canvas.style.cursor="grabbing";canvas.setPointerCapture(event.pointerId)};
    const move=(event:PointerEvent)=>{if(!dragging)return;group.rotation.y+=(event.clientX-last.x)*.008;group.rotation.x=Math.max(-1,Math.min(1,group.rotation.x+(event.clientY-last.y)*.008));last={x:event.clientX,y:event.clientY}};
    const up=()=>{dragging=false;canvas.style.cursor="grab"};
    canvas.addEventListener("pointerdown",down);canvas.addEventListener("pointermove",move);canvas.addEventListener("pointerup",up);canvas.addEventListener("pointercancel",up);
    let frame = 0;
    const render = () => {
      if (!reduced&&!dragging) group.rotation.z += 0.0015;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();
    const resize = new ResizeObserver(() => {
      const nextWidth = host.clientWidth || width;
      camera.aspect = nextWidth / height;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, height);
    });
    resize.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.removeEventListener("pointerdown",down);canvas.removeEventListener("pointermove",move);canvas.removeEventListener("pointerup",up);canvas.removeEventListener("pointercancel",up);
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [stars, size, lit]);
  return <div ref={mount} className={`lamp-preview ${lit ? "is-lit" : ""}`} aria-label={`可旋转星空灯三维预览，${lit ? "已点亮" : "未点亮"}`} />;
}
