/**
 * Html — Overlay HTML element positioned in 3D space for Three.js.
 *
 * Renders a DOM element that tracks a 3D position in the scene,
 * projecting it to screen coordinates each frame. Supports two
 * positioning strategies:
 *
 * - **2D projection mode** (default): Projects the 3D world position
 *   to screen pixels via `Vector3.project(camera)`, then positions
 *   the DOM element with `translate3d`. Optionally scales by distance
 *   (`distanceFactor`) for a perspective feel.
 *
 * - **CSS3D transform mode** (`transform: true`): Constructs full
 *   `matrix3d` CSS transforms from the Three.js camera and object
 *   matrices, achieving true 3D perspective on the HTML layer —
 *   similar to CSS3DRenderer but integrated into the normal render
 *   loop without a separate renderer.
 *
 * Based on the React Three Fiber drei `Html` component, rewritten
 * for vanilla Three.js without React dependencies.
 *
 * @module core/Html
 */

import * as THREE from 'three';
import type { ComponentOptions, IUpdatable, IDisposable } from '../types';

// ────────────────────────────── Shared Vectors ──────────────────────────────

const _v1 = /* @__PURE__ */ new THREE.Vector3();
const _v2 = /* @__PURE__ */ new THREE.Vector3();
const _v3 = /* @__PURE__ */ new THREE.Vector3();
const _v4 = /* @__PURE__ */ new THREE.Vector2();

// ────────────────────────────── Helper Functions ────────────────────────────

function defaultCalculatePosition(
	object: THREE.Object3D,
	camera: THREE.Camera,
	width: number,
	height: number,
): [number, number] {
	const objectPos = _v1.setFromMatrixPosition(object.matrixWorld);
	objectPos.project(camera);
	const widthHalf = width / 2;
	const heightHalf = height / 2;
	return [
		objectPos.x * widthHalf + widthHalf,
		-(objectPos.y * heightHalf) + heightHalf,
	];
}

function isObjectBehindCamera(object: THREE.Object3D, camera: THREE.Camera): boolean {
	const objectPos = _v1.setFromMatrixPosition(object.matrixWorld);
	const cameraPos = _v2.setFromMatrixPosition(camera.matrixWorld);
	const deltaCamObj = objectPos.sub(cameraPos);
	const camDir = camera.getWorldDirection(_v3);
	return deltaCamObj.angleTo(camDir) > Math.PI / 2;
}

function isObjectVisible(
	object: THREE.Object3D,
	camera: THREE.Camera,
	raycaster: THREE.Raycaster,
	occlude: THREE.Object3D[],
): boolean {
	const elPos = _v1.setFromMatrixPosition(object.matrixWorld);
	const screenPos = elPos.clone();
	screenPos.project(camera);
	_v4.set(screenPos.x, screenPos.y);
	raycaster.setFromCamera(_v4, camera);
	const intersects = raycaster.intersectObjects(occlude, true);
	if (intersects.length) {
		const intersectionDistance = intersects[0].distance;
		const pointDistance = elPos.distanceTo(raycaster.ray.origin);
		return pointDistance < intersectionDistance;
	}
	return true;
}

function objectScale(object: THREE.Object3D, camera: THREE.Camera): number {
	if (camera instanceof THREE.OrthographicCamera) {
		return camera.zoom;
	} else if (camera instanceof THREE.PerspectiveCamera) {
		const objectPos = _v1.setFromMatrixPosition(object.matrixWorld);
		const cameraPos = _v2.setFromMatrixPosition(camera.matrixWorld);
		const vFOV = (camera.fov * Math.PI) / 180;
		const dist = objectPos.distanceTo(cameraPos);
		const scaleFOV = 2 * Math.tan(vFOV / 2) * dist;
		return 1 / scaleFOV;
	}
	return 1;
}

function objectZIndex(
	object: THREE.Object3D,
	camera: THREE.Camera,
	zIndexRange: [number, number],
): number | undefined {
	if (
		camera instanceof THREE.PerspectiveCamera ||
		camera instanceof THREE.OrthographicCamera
	) {
		const objectPos = _v1.setFromMatrixPosition(object.matrixWorld);
		const cameraPos = _v2.setFromMatrixPosition(camera.matrixWorld);
		const dist = objectPos.distanceTo(cameraPos);
		const A = (zIndexRange[1] - zIndexRange[0]) / (camera.far - camera.near);
		const B = zIndexRange[1] - A * camera.far;
		return Math.round(A * dist + B);
	}
	return undefined;
}

function epsilon(value: number): number {
	return Math.abs(value) < 1e-10 ? 0 : value;
}

function getCSSMatrix(
	matrix: THREE.Matrix4,
	multipliers: number[],
	prepend = '',
): string {
	let matrix3d = 'matrix3d(';
	for (let i = 0; i !== 16; i++) {
		matrix3d +=
			epsilon(multipliers[i] * matrix.elements[i]) +
			(i !== 15 ? ',' : ')');
	}
	return prepend + matrix3d;
}

const CAMERA_MULTIPLIERS = [1, -1, 1, 1, 1, -1, 1, 1, 1, -1, 1, 1, 1, -1, 1, 1];

function getCameraCSSMatrix(matrix: THREE.Matrix4): string {
	return getCSSMatrix(matrix, CAMERA_MULTIPLIERS);
}

function getObjectCSSMatrix(matrix: THREE.Matrix4, factor: number): string {
	const f = factor;
	const multipliers = [
		1 / f, 1 / f, 1 / f, 1,
		-1 / f, -1 / f, -1 / f, -1,
		1 / f, 1 / f, 1 / f, 1,
		1, 1, 1, 1,
	];
	return getCSSMatrix(matrix, multipliers, 'translate(-50%,-50%)');
}

// ────────────────────────────── Occlusion Shaders ───────────────────────────

const OCCLUDE_VERTEX_SHADER = /* glsl */ `
	#include <common>

	void main() {
		vec2 center = vec2(0., 1.);
		float rotation = 0.0;
		float size = 0.03;

		vec4 mvPosition = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
		vec2 scale;
		scale.x = length(vec3(modelMatrix[0].x, modelMatrix[0].y, modelMatrix[0].z));
		scale.y = length(vec3(modelMatrix[1].x, modelMatrix[1].y, modelMatrix[1].z));

		bool isPerspective = isPerspectiveMatrix(projectionMatrix);
		if (isPerspective) scale *= -mvPosition.z;

		vec2 alignedPosition = (position.xy - (center - vec2(0.5))) * scale * size;
		vec2 rotatedPosition;
		rotatedPosition.x = cos(rotation) * alignedPosition.x - sin(rotation) * alignedPosition.y;
		rotatedPosition.y = sin(rotation) * alignedPosition.x + cos(rotation) * alignedPosition.y;
		mvPosition.xy += rotatedPosition;

		gl_Position = projectionMatrix * mvPosition;
	}
`;

const OCCLUDE_FRAGMENT_SHADER = /* glsl */ `
	void main() {
		gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
	}
`;

// ────────────────────────────── Public Types ────────────────────────────────

/** CSS `pointer-events` property values. */
export type PointerEventsValue =
	| 'auto' | 'none' | 'visiblePainted' | 'visibleFill'
	| 'visibleStroke' | 'visible' | 'painted' | 'fill'
	| 'stroke' | 'all' | 'inherit';

/** Occlusion mode. */
export type OccludeMode = boolean | 'raycast' | 'blending' | THREE.Object3D[];

/**
 * Options for constructing an {@link Html} component.
 */
export interface HtmlOptions extends ComponentOptions {
	el?: HTMLElement;
	as?: string;
	portal?: HTMLElement;
	prepend?: boolean;
	center?: boolean;
	fullscreen?: boolean;
	eps?: number;
	distanceFactor?: number;
	sprite?: boolean;
	transform?: boolean;
	zIndexRange?: [number, number];
	calculatePosition?: (object: THREE.Object3D, camera: THREE.Camera, width: number, height: number) => [number, number];
	wrapperClass?: string;
	pointerEvents?: PointerEventsValue;
	style?: Partial<CSSStyleDeclaration> | string;
	className?: string;
	occlude?: OccludeMode;
	onOcclude?: (hidden: boolean) => void;
	occludeGeometry?: THREE.BufferGeometry;
	occludeMaterial?: THREE.Material;
	castShadow?: boolean;
	receiveShadow?: boolean;
}

// ────────────────────────────── Html Component ──────────────────────────────

/**
 * Html — Overlay HTML element positioned in 3D space.
 *
 * @extends THREE.Group
 * Implements {@link IUpdatable} and {@link IDisposable}.
 */
export class Html extends THREE.Group implements IUpdatable, IDisposable {
	private _el: HTMLElement;
	/** The user-content div — always holds the actual HTML the user set.
	 *  When switching modes we restructure _el's wrapper hierarchy but
	 *  always keep the same _contentRef so user content is never lost. */
	private _contentRef: HTMLDivElement;
	private _transformOuterRef: HTMLDivElement | null = null;
	private _transformInnerRef: HTMLDivElement | null = null;

	private _portal: HTMLElement | null;
	private _prepend: boolean;
	private _isMounted = false;

	private _center: boolean;
	private _fullscreen: boolean;
	private _eps: number;
	private _distanceFactor: number | undefined;
	private _sprite: boolean;
	private _transform: boolean;
	private _zIndexRange: [number, number];
	private _calculatePosition: (object: THREE.Object3D, camera: THREE.Camera, width: number, height: number) => [number, number];

	private _wrapperClass: string | undefined;
	private _pointerEvents: PointerEventsValue;
	private _style: Partial<CSSStyleDeclaration> | string | undefined;
	private _className: string | undefined;

	private _occlude: OccludeMode;
	private _onOcclude: ((hidden: boolean) => void) | undefined;
	private _isRayCastOcclusion: boolean;
	private _occlusionMesh: THREE.Mesh | null = null;
	private _isMeshSizeSet = false;

	private _oldZoom = 0;
	private _oldPosition: [number, number] = [0, 0];
	private _visible = true;
	private _dirty = true;
	private _raycaster = new THREE.Raycaster();

	private _canvas: HTMLCanvasElement | null = null;

	constructor(options: HtmlOptions = {}) {
		const {
			el,
			as = 'div',
			portal,
			prepend = false,
			center = false,
			fullscreen = false,
			eps = 0.001,
			distanceFactor,
			sprite = false,
			transform = false,
			zIndexRange = [16777271, 0] as [number, number],
			calculatePosition = defaultCalculatePosition,
			wrapperClass,
			pointerEvents = 'auto',
			style,
			className,
			occlude = false,
			onOcclude,
			occludeGeometry,
			occludeMaterial,
			castShadow = false,
			receiveShadow = false,
		} = options;

		super();

		if (options.name) this.name = options.name;
		if (options.visible !== undefined) this.visible = options.visible;
		if (options.userData) this.userData = { ...options.userData };

		this._el = el ?? document.createElement(as);

		// Move any existing child nodes out of _el into _contentRef.
		// This ensures user content is preserved and never mixed with wrapper divs.
		this._contentRef = document.createElement('div');
		while (this._el.firstChild) {
			this._contentRef.appendChild(this._el.firstChild);
		}

		this._portal = portal ?? null;
		this._prepend = prepend;

		this._center = center;
		this._fullscreen = fullscreen;
		this._eps = eps;
		this._distanceFactor = distanceFactor;
		this._sprite = sprite;
		this._transform = transform;
		this._zIndexRange = zIndexRange;
		this._calculatePosition = calculatePosition;

		this._wrapperClass = wrapperClass;
		this._pointerEvents = pointerEvents;
		this._style = style;
		this._className = className;

		this._occlude = occlude;
		this._onOcclude = onOcclude;
		this._isRayCastOcclusion = this._computeIsRayCastOcclusion(occlude);

		if (occlude && !this._isRayCastOcclusion && occlude !== 'blending') {
			const geometry = occludeGeometry ?? new THREE.PlaneGeometry();
			const material =
				occludeMaterial ??
				new THREE.ShaderMaterial({
					side: THREE.DoubleSide,
					vertexShader: transform ? undefined : OCCLUDE_VERTEX_SHADER,
					fragmentShader: OCCLUDE_FRAGMENT_SHADER,
				});
			this._occlusionMesh = new THREE.Mesh(geometry, material);
			this._occlusionMesh.castShadow = castShadow;
			this._occlusionMesh.receiveShadow = receiveShadow;
			this.add(this._occlusionMesh);
		}
	}

	/** The underlying DOM element (root wrapper). */
	get element(): HTMLElement { return this._el; }
	/** The user-content div — always holds the actual HTML content. */
	get contentElement(): HTMLDivElement { return this._contentRef; }
	/** The transform outer wrapper div (only in transform mode). */
	get transformOuter(): HTMLDivElement | null { return this._transformOuterRef; }
	/** The transform inner wrapper div (only in transform mode). */
	get transformInner(): HTMLDivElement | null { return this._transformInnerRef; }
	/** The occlusion mesh (if created). */
	get occlusionMesh(): THREE.Mesh | null { return this._occlusionMesh; }

	/**
	 * Mount the HTML element into the DOM.
	 * Called automatically on the first `update()`.
	 */
	mount(renderer: THREE.WebGLRenderer): void {
		if (this._isMounted) return;

		const canvas = renderer.domElement;
		this._canvas = canvas;

		const target = this._portal ?? (canvas.parentNode as HTMLElement);
		if (!target) return;

		if (this._occlude === 'blending') {
			canvas.style.zIndex = `${Math.floor(this._zIndexRange[0] / 2)}`;
			canvas.style.position = 'absolute';
			canvas.style.pointerEvents = 'none';
		}

		this._applyElStyle();
		if (this._wrapperClass) this._el.className = this._wrapperClass;
		this._buildContent();

		if (this._prepend) {
			target.prepend(this._el);
		} else {
			target.appendChild(this._el);
		}

		this._isMounted = true;
	}

	/**
	 * Per-frame update — call from your render loop.
	 */
	update(delta: number, camera?: THREE.Camera, renderer?: THREE.WebGLRenderer): void {
		if (!camera || !renderer) return;
		if (!this._isMounted) this.mount(renderer);

		const size = renderer.getSize(_v4);
		const width = size.x;
		const height = size.y;

		camera.updateMatrixWorld();
		this.updateWorldMatrix(true, false);

		const vec = this._transform
			? this._oldPosition
			: this._calculatePosition(this, camera, width, height);

		const cameraZoom =
			camera instanceof THREE.OrthographicCamera
				? camera.zoom
				: camera instanceof THREE.PerspectiveCamera
					? camera.zoom
					: 1;

		if (
			this._dirty ||
			this._transform ||
			Math.abs(this._oldZoom - cameraZoom) > this._eps ||
			Math.abs(this._oldPosition[0] - vec[0]) > this._eps ||
			Math.abs(this._oldPosition[1] - vec[1]) > this._eps
		) {
			this._dirty = false;

			const isBehindCamera = isObjectBehindCamera(this, camera);

			let raytraceTarget: THREE.Object3D[] | false = false;
			if (this._isRayCastOcclusion) {
				if (Array.isArray(this._occlude)) {
					raytraceTarget = this._occlude;
				} else if (this._occlude !== 'blending') {
					const root = this.parent;
					raytraceTarget = root ? [root] : [];
				}
			}

			const previouslyVisible = this._visible;
			if (raytraceTarget) {
				const isVisible = isObjectVisible(this, camera, this._raycaster, raytraceTarget);
				this._visible = isVisible && !isBehindCamera;
			} else {
				this._visible = !isBehindCamera;
			}

			if (previouslyVisible !== this._visible) {
				if (this._onOcclude) {
					this._onOcclude(!this._visible);
				} else {
					this._el.style.display = this._visible ? 'block' : 'none';
				}
			}

			const halfRange = Math.floor(this._zIndexRange[0] / 2);
			const zRange: [number, number] = this._occlude
				? this._isRayCastOcclusion
					? [this._zIndexRange[0], halfRange]
					: [halfRange - 1, 0]
				: this._zIndexRange;

			const zIndex = objectZIndex(this, camera, zRange);
			if (zIndex !== undefined) {
				this._el.style.zIndex = `${zIndex}`;
			}

			if (this._transform) {
				this._updateTransformMode(camera, width, height);
			} else {
				this._updateProjectionMode(camera, vec);
			}

			this._oldPosition = [vec[0], vec[1]];
			this._oldZoom = cameraZoom;
		}

		this._updateOcclusionMeshSize(camera, width, height);
	}

	/** Rebuild DOM content structure (e.g. after changing innerHTML on contentElement). */
	refreshContent(): void {
		this._buildContent();
		this._isMeshSizeSet = false;
	}

	/** Switch CSS3D transform / 2D projection mode at runtime. */
	setTransform(enabled: boolean): this {
		if (this._transform === enabled) return this;
		this._transform = enabled;
		this._dirty = true;
		if (this._isMounted) {
			this._applyElStyle();
			this._buildContent();
		}
		return this;
	}

	/** Toggle billboard (always-face-camera) at runtime. */
	setSprite(enabled: boolean): this {
		this._sprite = enabled;
		this._dirty = true;
		return this;
	}

	/** Toggle centering at runtime. */
	setCenter(enabled: boolean): this {
		this._center = enabled;
		this._dirty = true;
		if (this._isMounted) this._buildContent();
		return this;
	}

	/** Change occlusion mode at runtime. */
	setOcclude(mode: OccludeMode): this {
		this._occlude = mode;
		this._isRayCastOcclusion = this._computeIsRayCastOcclusion(mode);
		this._dirty = true;
		if (this._canvas) {
			if (mode === 'blending') {
				this._canvas.style.zIndex = `${Math.floor(this._zIndexRange[0] / 2)}`;
				this._canvas.style.position = 'absolute';
				this._canvas.style.pointerEvents = 'none';
			} else {
				this._canvas.style.zIndex = '';
				this._canvas.style.position = '';
				this._canvas.style.pointerEvents = '';
			}
		}
		return this;
	}

	/** Set distance factor. Marks dirty for next update. */
	setDistanceFactor(factor: number): this {
		this._distanceFactor = factor;
		this._dirty = true;
		return this;
	}

	setWrapperClass(className: string): this {
		this._wrapperClass = className;
		this._el.className = className;
		return this;
	}

	setClassName(className: string): this {
		this._className = className;
		this._contentRef.className = className;
		return this;
	}

	setStyle(style: Partial<CSSStyleDeclaration> | string): this {
		this._style = style;
		if (typeof style === 'string') {
			this._contentRef.style.cssText = style;
		} else {
			Object.assign(this._contentRef.style, style);
		}
		return this;
	}

	dispose(): void {
		if (this._el.parentNode) {
			this._el.parentNode.removeChild(this._el);
		}
		this._isMounted = false;

		if (this._canvas) {
			this._canvas.style.zIndex = '';
			this._canvas.style.position = '';
			this._canvas.style.pointerEvents = '';
			this._canvas = null;
		}

		if (this._occlusionMesh) {
			this._occlusionMesh.geometry?.dispose();
			if (Array.isArray(this._occlusionMesh.material)) {
				this._occlusionMesh.material.forEach((m) => m.dispose());
			} else {
				this._occlusionMesh.material?.dispose();
			}
		}

		this.traverse((child) => {
			if (child instanceof THREE.Mesh && child !== this._occlusionMesh) {
				child.geometry?.dispose();
				if (Array.isArray(child.material)) {
					child.material.forEach((m) => m.dispose());
				} else {
					child.material?.dispose();
				}
			}
		});

		this.clear();
		if (this.parent) this.parent.remove(this);
	}

	// ────────────────────────────── Private Methods ──────────────────────────

	private _computeIsRayCastOcclusion(occlude: OccludeMode): boolean {
		if (!occlude || occlude === 'blending') return false;
		if (Array.isArray(occlude)) return true;
		return occlude === 'raycast';
	}

	/** Apply the root _el style based on current mode. */
	private _applyElStyle(): void {
		if (this._transform) {
			this._el.style.cssText =
				'position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;';
		} else {
			this._el.style.cssText =
				'position:absolute;top:0;left:0;transform:translate3d(0px,0px,0);transform-origin:0 0;';
		}
		if (this._wrapperClass) this._el.className = this._wrapperClass;
	}

	/**
	 * Build the DOM content structure.
	 *
	 * Key invariant: `_contentRef` always holds the user's HTML content.
	 * When switching modes we only change the wrapper hierarchy around it,
	 * never touching _contentRef's children.
	 */
	private _buildContent(): void {
		// Apply user styles/class to _contentRef
		this._contentRef.style.position = 'relative'; // allow content to flow naturally

		if (this._className) this._contentRef.className = this._className;
		// Only apply _style if it hasn't been manually set by user via setStyle()
		// (setStyle writes directly, so we respect that)

		if (this._transform) {
			// Transform mode: _el → outerRef → innerRef → _contentRef
			if (!this._transformOuterRef) {
				this._transformOuterRef = document.createElement('div');
				this._transformInnerRef = document.createElement('div');
			}

			const outerRef = this._transformOuterRef!;
			const innerRef = this._transformInnerRef!;

			outerRef.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;transform-style:preserve-3d;pointer-events:none;';
			innerRef.style.cssText = `position:absolute;pointer-events:${this._pointerEvents};`;

			// Assemble: outer → inner → contentRef
			innerRef.innerHTML = '';
			innerRef.appendChild(this._contentRef);
			outerRef.innerHTML = '';
			outerRef.appendChild(innerRef);

			this._el.innerHTML = '';
			this._el.appendChild(outerRef);
		} else {
			// Non-transform mode: _el → _contentRef (with optional centering wrapper styles)
			let contentCss = 'position:absolute;';
			if (this._center) {
				contentCss += 'transform:translate3d(-50%,-50%,0);';
			}
			if (this._fullscreen) {
				contentCss += 'top:-50%;left:-50%;width:100%;height:100%;';
			}
			this._contentRef.style.cssText = contentCss;

			this._el.innerHTML = '';
			this._el.appendChild(this._contentRef);
		}
	}

	private _updateTransformMode(
		camera: THREE.Camera,
		width: number,
		height: number,
	): void {
		const widthHalf = width / 2;
		const heightHalf = height / 2;
		const fov = camera.projectionMatrix.elements[5] * heightHalf;

		const isOrthographic = camera instanceof THREE.OrthographicCamera;
		const cameraMatrix = getCameraCSSMatrix(camera.matrixWorldInverse);

		let cameraTransform: string;
		if (isOrthographic) {
			const ortho = camera as THREE.OrthographicCamera;
			cameraTransform = `scale(${fov})translate(${epsilon(-(ortho.right + ortho.left) / 2)}px,${epsilon((ortho.top + ortho.bottom) / 2)}px)`;
		} else {
			cameraTransform = `translateZ(${fov}px)`;
		}

		let matrix = this.matrixWorld;
		if (this._sprite) {
			matrix = camera.matrixWorldInverse.clone().transpose().copyPosition(matrix).scale(this.scale);
			matrix.elements[3] = matrix.elements[7] = matrix.elements[11] = 0;
			matrix.elements[15] = 1;
		}

		this._el.style.width = width + 'px';
		this._el.style.height = height + 'px';
		this._el.style.perspective = isOrthographic ? '' : `${fov}px`;

		if (this._transformOuterRef && this._transformInnerRef) {
			this._transformOuterRef.style.transform =
				`${cameraTransform}${cameraMatrix}translate(${widthHalf}px,${heightHalf}px)`;
			this._transformInnerRef.style.transform = getObjectCSSMatrix(
				matrix,
				1 / ((this._distanceFactor ?? 10) / 400),
			);
		}
	}

	private _updateProjectionMode(
		camera: THREE.Camera,
		vec: [number, number],
	): void {
		const scale =
			this._distanceFactor === undefined
				? 1
				: objectScale(this, camera) * this._distanceFactor;
		this._el.style.transform = `translate3d(${vec[0]}px,${vec[1]}px,0) scale(${scale})`;
	}

	private _updateOcclusionMeshSize(
		camera: THREE.Camera,
		_width: number,
		_height: number,
	): void {
		if (!this._occlusionMesh || this._isRayCastOcclusion || this._isMeshSizeSet) return;

		// Always use _contentRef for dimensions — it holds the actual user content
		if (this._transform) {
			if (this._contentRef.clientWidth && this._contentRef.clientHeight) {
				const isOrthographic = camera instanceof THREE.OrthographicCamera;

				if (isOrthographic) {
					const s = this.scale;
					if (s.x === s.y && s.y === s.z) {
						this._occlusionMesh.scale.setScalar(1 / s.x);
					} else {
						this._occlusionMesh.scale.set(1 / s.x, 1 / s.y, 1 / s.z);
					}
				} else {
					const ratio = (this._distanceFactor ?? 10) / 400;
					const w = this._contentRef.clientWidth * ratio;
					const h = this._contentRef.clientHeight * ratio;
					this._occlusionMesh.scale.set(w, h, 1);
				}

				this._isMeshSizeSet = true;
			}
		} else {
			if (this._contentRef.clientWidth && this._contentRef.clientHeight) {
				const cameraPos = _v1.setFromMatrixPosition(camera.matrixWorld);
				const objectPos = _v2.setFromMatrixPosition(this.matrixWorld);
				const dist = objectPos.distanceTo(cameraPos);

				let factor: number;
				if (camera instanceof THREE.PerspectiveCamera) {
					const vFOV = (camera.fov * Math.PI) / 180;
					factor = 1 / (2 * Math.tan(vFOV / 2) * dist);
				} else if (camera instanceof THREE.OrthographicCamera) {
					factor = camera.zoom;
				} else {
					factor = 1;
				}

				const ratio = 1 / factor;
				const w = this._contentRef.clientWidth * ratio;
				const h = this._contentRef.clientHeight * ratio;
				this._occlusionMesh.scale.set(w, h, 1);

				this._isMeshSizeSet = true;
			}

			this._occlusionMesh.lookAt(camera.position);
		}
	}
}
