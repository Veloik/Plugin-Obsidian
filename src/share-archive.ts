import { unzipSync } from "fflate";
import { tr } from "./i18n";

export const MAX_SHARE_COMPRESSED = 64 * 1024 * 1024;
const MAX_SHARE_EXPANDED = 128 * 1024 * 1024;

/** Bound allocations before inflating attachments, especially on phones. */
export function unpackShareArchive(bytes: Uint8Array, maxExpanded = MAX_SHARE_EXPANDED): Record<string, Uint8Array> {
	if (bytes.byteLength > MAX_SHARE_COMPRESSED) throw new Error(tr("El paquete supera el límite de 64 MB comprimidos."));
	let expanded = 0;
	let count = 0;
	return unzipSync(bytes, { filter: entry => {
		expanded += entry.originalSize;
		if (++count > 5000 || !Number.isSafeInteger(expanded) || expanded > maxExpanded) {
			throw new Error(tr("El paquete contiene demasiados archivos o supera el límite de memoria al descomprimir."));
		}
		return true;
	} });
}
