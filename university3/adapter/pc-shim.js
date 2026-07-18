// Maps the 'playcanvas' module specifier onto the engine global provided by the
// PlayCanvas launch runtime.
const _pc = globalThis.pc;
export const math = _pc.math;
export const Vec3 = _pc.Vec3;
export const Quat = _pc.Quat;
export const Mat4 = _pc.Mat4;
export const Asset = _pc.Asset;
export const INDEXFORMAT_UINT32 = _pc.INDEXFORMAT_UINT32;
export const SEMANTIC_POSITION = _pc.SEMANTIC_POSITION;
export default _pc;
