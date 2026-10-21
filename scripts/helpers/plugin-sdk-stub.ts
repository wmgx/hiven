import * as textTransforms from '../../src/kits/textTransforms/index.ts'

/** Node-side stand-in for the host SDK: plugin cores only read `kits.textTransforms`. */
export function getPluginHostSdk() {
  return { kits: { textTransforms } }
}
