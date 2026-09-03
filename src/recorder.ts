import { Notice, setIcon } from "obsidian";
import { Mp3Encoder } from "@breezystack/lamejs";
import { makeDraggable } from "./panels";
import { tr } from "./i18n";

/**
 * Audio recorder: microphone → MediaRecorder → MP3 encoded on this device
 * (no service involved) → saved in the vault and dropped on the board.
 */

export interface RecorderHost {
	/** Stores the MP3 in the vault and places it on the board. */
	saveRecording(mp3: ArrayBuffer, seconds: number): Promise<void>;
	/** Optional speech-to-text, where the platform offers it. */
	startDictation(): void;
}

type State = "idle" | "requesting" | "recording" | "encoding";

function formatClock(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function pickMimeType(): string | undefined {
	const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
	return candidates.find(type => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type));
}

/** Decodes whatever the browser recorded and encodes it as a 128 kbps MP3. */
export async function encodeMp3(recording: Blob, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
	const context = new AudioContext();
	let decoded: AudioBuffer;
	try {
		decoded = await context.decodeAudioData(await recording.arrayBuffer());
	} finally {
		void context.close();
	}
	const channels = Math.min(2, decoded.numberOfChannels);
	const encoder = new Mp3Encoder(channels, decoded.sampleRate, 128);
	const left = decoded.getChannelData(0);
	const right = channels === 2 ? decoded.getChannelData(1) : null;
	const block = 1152;
	const parts: Uint8Array[] = [];
	const toInt16 = (samples: Float32Array): Int16Array => {
		const out = new Int16Array(samples.length);
		for (let i = 0; i < samples.length; i++) {
			const v = Math.max(-1, Math.min(1, samples[i]));
			out[i] = v < 0 ? v * 32768 : v * 32767;
		}
		return out;
	};
	for (let offset = 0; offset < left.length; offset += block) {
		const l = toInt16(left.subarray(offset, offset + block));
		const r = right ? toInt16(right.subarray(offset, offset + block)) : undefined;
		const chunk = r ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l);
		if (chunk.length) parts.push(chunk);
		if (onProgress && (offset / block) % 200 === 0) {
			onProgress(offset / left.length);
			await new Promise(resolve => setTimeout(resolve, 0));
		}
	}
	const tail = encoder.flush();
	if (tail.length) parts.push(tail);
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let at = 0;
	for (const p of parts) { out.set(p, at); at += p.length; }
	return out.buffer;
}

function explainMediaError(error: unknown): string {
	const name = error instanceof DOMException ? error.name : "";
	if (name === "NotAllowedError" || name === "SecurityError") {
		return "Obsidian no tiene permiso para usar el micrófono. En Windows: Configuración → Privacidad y seguridad → Micrófono, activa «Permitir que las aplicaciones de escritorio accedan al micrófono».";
	}
	if (name === "NotFoundError" || name === "OverconstrainedError") return "No se encontró ningún micrófono.";
	if (name === "NotReadableError") return "Otra aplicación está usando el micrófono.";
	return error instanceof Error ? error.message : "No se pudo iniciar la grabación.";
}

export function createRecorderPanel(host: RecorderHost, container: HTMLElement): { toggle: () => void; isOpen: () => boolean } {
	const panel = container.createDiv({ cls: "notelens-recorder hidden" });
	for (const type of ["pointerdown", "pointerup", "dblclick"]) panel.addEventListener(type, (e) => e.stopPropagation());
	panel.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
	panel.addEventListener("keydown", (e) => e.stopPropagation());

	const header = panel.createDiv({ cls: "notelens-recorder-header" });
	setIcon(header.createSpan({ cls: "notelens-calculator-icon" }), "mic");
	header.createSpan({ cls: "notelens-calculator-title", text: tr("Grabadora") });
	const closeBtn = header.createEl("button", { cls: "notelens-embed-close" });
	setIcon(closeBtn, "x");
	makeDraggable(panel, header, container, "notelens-recorder-pos");

	const status = panel.createDiv({ cls: "notelens-recorder-status", text: tr("Lista. La grabación se guarda como MP3 en la bóveda y aparece en la pizarra.") });
	const clock = panel.createDiv({ cls: "notelens-recorder-clock", text: "00:00" });
	const meter = panel.createDiv({ cls: "notelens-recorder-meter" });
	const meterFill = meter.createDiv({ cls: "notelens-recorder-meter-fill" });

	const actions = panel.createDiv({ cls: "notelens-recorder-actions" });
	const recordBtn = actions.createEl("button", { cls: "notelens-recorder-record" });
	setIcon(recordBtn.createSpan(), "circle");
	recordBtn.createSpan({ text: tr("Grabar") });
	const stopBtn = actions.createEl("button", { cls: "notelens-recorder-stop" });
	setIcon(stopBtn.createSpan(), "square");
	stopBtn.createSpan({ text: tr("Detener y guardar") });
	const cancelBtn = actions.createEl("button", { cls: "notelens-recorder-cancel", text: tr("Descartar") });

	const dictation = panel.createEl("button", { cls: "notelens-recorder-dictation" });
	setIcon(dictation.createSpan(), "captions");
	dictation.createSpan({ text: tr("Dictado a texto (si tu sistema lo permite)") });
	dictation.onclick = () => host.startDictation();

	let state: State = "idle";
	let recorder: MediaRecorder | null = null;
	let stream: MediaStream | null = null;
	let chunks: Blob[] = [];
	let startedAt = 0;
	let timer: number | null = null;
	let analyser: AnalyserNode | null = null;
	let audioContext: AudioContext | null = null;
	let meterFrame = 0;

	const setState = (next: State) => {
		state = next;
		panel.setAttr("data-state", next);
		recordBtn.disabled = next !== "idle";
		stopBtn.disabled = next !== "recording";
		cancelBtn.disabled = next !== "recording";
	};

	const cleanupStream = () => {
		if (timer !== null) window.clearInterval(timer);
		timer = null;
		cancelAnimationFrame(meterFrame);
		meterFill.setCssStyles({ width: "0%" });
		stream?.getTracks().forEach(track => track.stop());
		stream = null;
		void audioContext?.close();
		audioContext = null;
		analyser = null;
	};

	const tick = () => {
		clock.setText(formatClock((performance.now() - startedAt) / 1000));
	};

	const pumpMeter = () => {
		if (!analyser) return;
		const data = new Uint8Array(analyser.fftSize);
		analyser.getByteTimeDomainData(data);
		let peak = 0;
		for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
		meterFill.style.width = `${Math.min(100, Math.round(peak * 140))}%`;
		meterFrame = requestAnimationFrame(pumpMeter);
	};

	const start = async () => {
		if (state !== "idle") return;
		if (typeof navigator.mediaDevices?.getUserMedia !== "function" || typeof MediaRecorder === "undefined") {
			new Notice(tr("Este dispositivo no permite grabar audio desde Obsidian."));
			return;
		}
		setState("requesting");
		status.setText(tr("Pidiendo acceso al micrófono…"));
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
		} catch (error) {
			setState("idle");
			status.setText(explainMediaError(error));
			new Notice(explainMediaError(error), 8000);
			return;
		}
		chunks = [];
		const mimeType = pickMimeType();
		recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
		recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
		recorder.onstop = () => void finish();
		try {
			audioContext = new AudioContext();
			const source = audioContext.createMediaStreamSource(stream);
			analyser = audioContext.createAnalyser();
			analyser.fftSize = 512;
			source.connect(analyser);
			pumpMeter();
		} catch { /* the level meter is optional */ }
		recorder.start(500);
		startedAt = performance.now();
		timer = window.setInterval(tick, 250);
		tick();
		setState("recording");
		status.setText(tr("Grabando… pulsa «Detener y guardar» cuando termines."));
	};

	let discard = false;
	const finish = async () => {
		const seconds = (performance.now() - startedAt) / 1000;
		const type = recorder?.mimeType || chunks[0]?.type || "audio/webm";
		recorder = null;
		cleanupStream();
		if (discard || chunks.length === 0) {
			discard = false;
			setState("idle");
			clock.setText("00:00");
			status.setText(chunks.length === 0 && !discard ? tr("No se grabó nada.") : tr("Grabación descartada."));
			chunks = [];
			return;
		}
		setState("encoding");
		status.setText(tr("Convirtiendo a MP3…"));
		try {
			const blob = new Blob(chunks, { type });
			chunks = [];
			const mp3 = await encodeMp3(blob, fraction => status.setText(tr("Convirtiendo a MP3… {p0}%", { p0: Math.round(fraction * 100) })));
			await host.saveRecording(mp3, seconds);
			status.setText(tr("Guardada ({p0}) y añadida a la pizarra.", { p0: formatClock(seconds) }));
		} catch (error) {
			console.error("NoteLens: recording failed", error);
			status.setText(tr("No se pudo guardar la grabación."));
			new Notice(tr("No se pudo guardar la grabación."));
		} finally {
			setState("idle");
			clock.setText("00:00");
		}
	};

	recordBtn.onclick = () => void start();
	stopBtn.onclick = () => { if (recorder && recorder.state !== "inactive") recorder.stop(); };
	cancelBtn.onclick = () => { discard = true; if (recorder && recorder.state !== "inactive") recorder.stop(); };

	let open = false;
	const toggle = () => {
		if (open && state === "recording") { new Notice(tr("Detén o descarta la grabación antes de cerrar la grabadora.")); return; }
		open = !open;
		panel.toggleClass("hidden", !open);
	};
	closeBtn.onclick = toggle;
	setState("idle");
	return { toggle, isOpen: () => open };
}
