import * as THREE from 'three';

/**
 * 视口尺寸（CSS 像素），用于把 3D 点投影到屏幕。
 *
 * 与 {@link calculateScaleFactor} 内部的 NDC 映射一致：以画布客户端尺寸为投影视口。
 */
export interface ViewportSize {
	/** 画布 CSS 宽度（像素）。 */
	width: number;
	/** 画布 CSS 高度（像素）。 */
	height: number;
}

const tV0 = /* @__PURE__ */ new THREE.Vector3();
const tV1 = /* @__PURE__ */ new THREE.Vector3();
const tV2 = /* @__PURE__ */ new THREE.Vector3();

/** 把 3D 世界点投影到屏幕像素坐标（原点左上）。 */
const getPoint2 = (point3: THREE.Vector3, camera: THREE.Camera, size: ViewportSize): THREE.Vector3 => {
	const widthHalf = size.width / 2;
	const heightHalf = size.height / 2;
	camera.updateMatrixWorld(false);
	const vector = point3.project(camera);
	vector.x = vector.x * widthHalf + widthHalf;
	vector.y = -(vector.y * heightHalf) + heightHalf;
	return vector;
};

/** 把屏幕像素点（原点左上）反投影到 3D 世界，使用给定的 NDC z。 */
const getPoint3 = (point2: THREE.Vector3, camera: THREE.Camera, size: ViewportSize, zValue = 1): THREE.Vector3 => {
	const vector = tV0.set((point2.x / size.width) * 2 - 1, -(point2.y / size.height) * 2 + 1, zValue);
	vector.unproject(camera);
	return vector;
};

/**
 * 计算世界空间缩放因子 —— 让一个 `radiusPx` 像素半径在 `point3` 处看起来恒定。
 *
 * 移植自 [drei calculateScaleFactor](https://github.com/pmndrs/drei/blob/master/src/core/calculateScaleFactor.ts)，
 * 用于 PivotControls 的 `fixed` 模式（gizmo 在屏幕上保持固定像素尺寸）。
 *
 * @param point3 - 需要保持恒定像素尺寸的世界空间参考点。
 * @param radiusPx - 目标像素半径。
 * @param camera - 观察相机。
 * @param size - 画布视口尺寸（CSS 像素）。
 * @returns 使 `radiusPx` 像素在 `point3` 处对应的世界空间距离。
 */
export const calculateScaleFactor = (
	point3: THREE.Vector3,
	radiusPx: number,
	camera: THREE.Camera,
	size: ViewportSize,
): number => {
	const point2 = getPoint2(tV2.copy(point3), camera, size);
	let scale = 0;
	for (let i = 0; i < 2; ++i) {
		const point2off = tV1.copy(point2).setComponent(i, point2.getComponent(i) + radiusPx);
		const point3off = getPoint3(point2off, camera, size, point2off.z);
		scale = Math.max(scale, point3.distanceTo(point3off));
	}
	return scale;
};
