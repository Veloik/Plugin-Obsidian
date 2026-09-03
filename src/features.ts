/**
 * Features that are written but not shipped yet.
 *
 * A flag rather than a deleted file: the code stays compiled, typechecked and
 * covered by the harness, so turning it back on is one boolean and not an
 * archaeology exercise. Flip a flag here, rebuild, and the feature is back
 * exactly as it was.
 */
export const EXPERIMENTAL = {
	/**
	 * Leen, the assistant: the pet on the board, his local study actions and
	 * the optional chat with a local model. Held back from the release while
	 * the rest of the board settles; the local model settings stay visible
	 * either way, because the translator speaks to the same server.
	 */
	assistant: false
} as const;
