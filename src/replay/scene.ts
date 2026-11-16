import * as THREE from 'three'
import { CONTACT_RADIUS, COURT, LINE } from '../domain/court'
import type { ReplayFrame } from '../domain/replay'

/**
 * Three.js 回放场景的薄适配层：只负责把 evaluateReplay 给出的帧状态搬到画面上，
 * 不参与时间推进、运镜计算或判定。
 */

export interface ReplayScene {
  render(frame: ReplayFrame): void
  resize(width: number, height: number): void
  dispose(): void
}

const LINE_COLOR = 0xf8fafc
const COURT_COLOR = 0x2f7d5e
const SURROUND_COLOR = 0x33574a
const BACKGROUND_COLOR = 0x0d1a16
const MARKER_IN = 0xfbbf24
const MARKER_OUT = 0xf87171

const FORWARD = new THREE.Vector3(0, 0, 1)
const MARKER_Y = 0.006

function addCourtLines(scene: THREE.Scene, material: THREE.Material) {
  const lineY = 0.004

  const add = (width: number, depth: number, x: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, lineY, z)
    scene.add(mesh)
  }

  // 双打边线与端线：外沿即有效边界
  for (const sign of [-1, 1]) {
    add(COURT.lineWidth, COURT.length, sign * LINE.doublesSidelineX, 0)
    add(COURT.doublesWidth, COURT.lineWidth, 0, sign * LINE.endLineZ)
    // 单打边线
    add(COURT.lineWidth, COURT.length, sign * LINE.singlesSidelineX, 0)
    // 前发球线
    add(COURT.doublesWidth, COURT.lineWidth, 0, sign * LINE.shortServiceLineZ)
    // 双打后发球线
    add(COURT.doublesWidth, COURT.lineWidth, 0, sign * LINE.doublesLongServiceLineZ)
    // 中线
    add(
      COURT.lineWidth,
      LINE.endLineZ - LINE.shortServiceLineZ,
      0,
      sign * ((LINE.endLineZ + LINE.shortServiceLineZ) / 2),
    )
  }
}

function addNet(scene: THREE.Scene) {
  const width = COURT.doublesWidth
  const bottom = 0.76
  const columns = 14
  const rows = 4

  const geometry = new THREE.PlaneGeometry(width, 1, columns, rows)
  const positions = geometry.attributes.position as THREE.BufferAttribute
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index)
    const y = positions.getY(index)
    const ratio = x / (width / 2)
    const top = COURT.netCentreHeight + (COURT.netPostHeight - COURT.netCentreHeight) * ratio * ratio
    const t = y + 0.5
    positions.setY(index, bottom + t * (top - bottom))
    positions.setZ(index, 0)
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()

  const plane = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0xcbd5e1,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.22,
      wireframe: true,
      depthWrite: false,
    }),
  )
  mesh.renderOrder = 1
  plane.renderOrder = 1
  scene.add(plane)
  scene.add(mesh)

  // 顶部白色网带
  const tape = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.02, 0.012),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 }),
  )
  tape.position.set(0, COURT.netPostHeight - 0.01, 0)
  scene.add(tape)

  const postGeometry = new THREE.CylinderGeometry(0.022, 0.024, COURT.netPostHeight, 16)
  const postMaterial = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.45,
    metalness: 0.25,
  })
  for (const sign of [-1, 1]) {
    const post = new THREE.Mesh(postGeometry, postMaterial)
    post.position.set(sign * COURT.doublesHalfWidth, COURT.netPostHeight / 2, 0)
    scene.add(post)
  }
}

interface Shuttle {
  group: THREE.Group
  materials: THREE.Material[]
}

function createShuttle(): Shuttle {
  const group = new THREE.Group()
  // 局部原点在球托底端，羽毛沿局部 +Y 向后延伸；
  // 再整体旋转，使飞行前向为局部 +Z、羽毛拖在 -Z。
  const body = new THREE.Group()
  body.rotation.x = -Math.PI / 2

  const corkMaterial = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.55,
    metalness: 0.02,
    transparent: true,
  })
  const cork = new THREE.Mesh(new THREE.SphereGeometry(CONTACT_RADIUS, 20, 14), corkMaterial)
  cork.position.y = CONTACT_RADIUS

  const skirtMaterial = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.9,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
  })
  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, CONTACT_RADIUS * 1.05, 0.068, 20, 1, true),
    skirtMaterial,
  )
  skirt.position.y = 0.056

  const rimMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.75,
    transparent: true,
    opacity: 0.9,
  })
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.0016, 6, 28), rimMaterial)
  rim.rotation.x = Math.PI / 2
  rim.position.y = 0.09

  body.add(cork, skirt, rim)
  group.add(body)

  return { group, materials: [corkMaterial, skirtMaterial, rimMaterial] }
}

function createPlateTexture(text: 'IN' | 'OUT'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 160
  const context = canvas.getContext('2d')
  if (context) {
    const accent = text === 'IN' ? '#4ade80' : '#f87171'
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = 'rgba(6, 16, 14, 0.86)'
    context.strokeStyle = accent
    context.lineWidth = 6
    const radius = 26
    context.beginPath()
    context.moveTo(radius, 8)
    context.lineTo(canvas.width - radius, 8)
    context.quadraticCurveTo(canvas.width - 8, 8, canvas.width - 8, radius)
    context.lineTo(canvas.width - 8, canvas.height - radius)
    context.quadraticCurveTo(canvas.width - 8, canvas.height - 8, canvas.width - radius, canvas.height - 8)
    context.lineTo(radius, canvas.height - 8)
    context.quadraticCurveTo(8, canvas.height - 8, 8, canvas.height - radius)
    context.lineTo(8, radius)
    context.quadraticCurveTo(8, 8, radius, 8)
    context.closePath()
    context.fill()
    context.stroke()

    context.fillStyle = accent
    context.font = '700 96px "Inter", "PingFang SC", system-ui, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 4)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

export interface ReplaySceneOptions {
  /**
   * 渲染像素比。预览不传时取设备 DPR 且不超过 2；
   * 导出固定分辨率时传 1，保证画布像素与目标尺寸一致。
   */
  pixelRatio?: number
}

export function createReplayScene(
  canvas: HTMLCanvasElement,
  options: ReplaySceneOptions = {},
): ReplayScene {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(options.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(BACKGROUND_COLOR, 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(BACKGROUND_COLOR, 20, 60)

  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.05, 140)
  scene.add(camera)

  scene.add(new THREE.HemisphereLight(0xd6e8ff, 0x122a22, 1.0))

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.35)
  keyLight.position.set(5, 12, 7)
  scene.add(keyLight)

  const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.35)
  fillLight.position.set(-8, 6, -9)
  scene.add(fillLight)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 52),
    new THREE.MeshStandardMaterial({ color: SURROUND_COLOR, roughness: 1 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.012
  scene.add(ground)

  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(COURT.doublesWidth, COURT.length),
    new THREE.MeshStandardMaterial({ color: COURT_COLOR, roughness: 0.92 }),
  )
  surface.rotation.x = -Math.PI / 2
  scene.add(surface)

  const lineMaterial = new THREE.MeshBasicMaterial({ color: LINE_COLOR })
  addCourtLines(scene, lineMaterial)
  addNet(scene)

  const shuttle = createShuttle()
  scene.add(shuttle.group)

  const markerMaterial = new THREE.MeshBasicMaterial({
    color: MARKER_IN,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  })
  const marker = new THREE.Mesh(new THREE.CircleGeometry(CONTACT_RADIUS, 48), markerMaterial)
  marker.rotation.x = -Math.PI / 2
  marker.position.y = MARKER_Y
  marker.renderOrder = 2
  scene.add(marker)

  const plateTextures: Record<'IN' | 'OUT', THREE.CanvasTexture> = {
    IN: createPlateTexture('IN'),
    OUT: createPlateTexture('OUT'),
  }
  const plateMaterials: Record<'IN' | 'OUT', THREE.SpriteMaterial> = {
    IN: new THREE.SpriteMaterial({
      map: plateTextures.IN,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    }),
    OUT: new THREE.SpriteMaterial({
      map: plateTextures.OUT,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    }),
  }
  const plates: Record<'IN' | 'OUT', THREE.Sprite> = {
    IN: new THREE.Sprite(plateMaterials.IN),
    OUT: new THREE.Sprite(plateMaterials.OUT),
  }
  for (const key of ['IN', 'OUT'] as const) {
    plates[key].visible = false
    plates[key].renderOrder = 10
    camera.add(plates[key])
  }

  function render(frame: ReplayFrame) {
    camera.position.set(frame.camera.position.x, frame.camera.position.y, frame.camera.position.z)
    camera.fov = frame.camera.fov
    camera.updateProjectionMatrix()
    camera.lookAt(frame.camera.target.x, frame.camera.target.y, frame.camera.target.z)

    shuttle.group.position.set(frame.ball.position.x, frame.ball.position.y, frame.ball.position.z)
    shuttle.group.quaternion.setFromUnitVectors(
      FORWARD,
      new THREE.Vector3(frame.ball.forward.x, frame.ball.forward.y, frame.ball.forward.z).normalize(),
    )
    shuttle.group.visible = frame.ball.opacity > 0.002
    for (const material of shuttle.materials) {
      material.transparent = true
      material.opacity = frame.ball.opacity
    }

    marker.position.set(frame.marker.center.x, MARKER_Y, frame.marker.center.z)
    markerMaterial.opacity = frame.marker.opacity
    markerMaterial.color.setHex(frame.verdict === 'IN' ? MARKER_IN : MARKER_OUT)
    marker.visible = frame.marker.opacity > 0.002

    // 结果牌固定在画面下方，随 FOV 换算尺寸，保证导出时始终同屏可读
    const distance = 1.2
    const halfHeight = Math.tan((frame.camera.fov * Math.PI) / 360) * distance
    const plateHeight = halfHeight * 0.17
    const plateWidth = plateHeight * 3.2
    for (const key of ['IN', 'OUT'] as const) {
      const active = key === frame.verdict && frame.resultOpacity > 0.002
      plates[key].visible = active
      plates[key].scale.set(plateWidth, plateHeight, 1)
      plates[key].position.set(0, -halfHeight * 0.74, -distance)
      plateMaterials[key].opacity = active ? frame.resultOpacity : 0
    }

    renderer.render(scene, camera)
  }

  function resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  function dispose() {
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material
      if (Array.isArray(material)) material.forEach((item) => item.dispose())
      else if (material) material.dispose()
    })
    for (const key of ['IN', 'OUT'] as const) plateTextures[key].dispose()
    // 不主动丢失上下文：开发模式下 StrictMode 会在同一 canvas 上重建场景，
    // 丢失上下文会让第二次创建拿到 null 的精度信息而失败。
    renderer.dispose()
  }

  return { render, resize, dispose }
}
