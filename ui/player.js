const byId = (id) => document.getElementById(id);
const human = (value) => String(value ?? "").replaceAll("_", " ");
const stamp = (seconds = 0) => {
	const sec = Math.floor(Math.max(0, Number(seconds) || 0));
	return [Math.floor(sec / 60), sec % 60]
		.map((n) => String(n).padStart(2, "0"))
		.join(":");
};
const money = (micros) => `$${(micros / 1e6).toFixed(6)}`;
function element(tag, value, cls) {
	const node = document.createElement(tag);
	if (value != null) node.textContent = value;
	if (cls) node.className = cls;
	return node;
}
function pair(label, value) {
	const row = element("div", null, "pair");
	row.append(element("span", label), element("code", value));
	return row;
}
const empty = (text) => element("p", text, "muted");
const list = (value) => (Array.isArray(value) ? value : []);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const live = byId("data").textContent === "null";
let snapshot;
let moments = [];
let selected = 0;
let video;

function status(state, notice = "") {
	const run = snapshot?.run;
	byId("state").textContent = state;
	byId("notice").hidden = !notice;
	byId("notice").textContent = notice;
	const connected = live && state !== "disconnected";
	document.body.dataset.live = String(connected);
	byId("mode").textContent = connected
		? "Live replay"
		: state === "disconnected"
			? "Saved snapshot"
			: "Recorded replay";
	const verdict = run?.verdict;
	const observed = snapshot?.observed ?? run?.replay?.observed;
	const reproduction = snapshot?.reproStatus ?? run?.replay?.status;
	const stopped = list(run?.replay?.events).findLast(
		(event) => event.type === "stopped",
	);
	const refused = [
		snapshot?.proof?.status,
		stopped?.reason,
		run?.error,
		reproduction,
	].find((value) => /refus/i.test(value ?? ""));
	let badge = human(verdict || state);
	let detail = "";
	if (observed === true) detail = "Failure observed in the browser";
	if (observed === false || reproduction === "not_reproduced")
		detail = "Not reproduced";
	if (refused) detail = human(refused);
	if (
		observed === false &&
		["reproduced", "proof_verified", "failure_observed"].includes(verdict)
	)
		badge = "Conflicting evidence";
	if (state === "error" || state === "loading") badge = state;
	byId("badge").textContent = badge;
	byId("badge").dataset.tone =
		badge === "proof verified"
			? "good"
			: /error|refus|miss|not reproduced|conflicting/i.test(badge)
				? "bad"
				: "";
	byId("summary").textContent = detail;
}

function actionText(entry) {
	return [
		human(entry.action),
		entry.target ??
			entry.detail ??
			(entry.type !== "action" ? entry.reason : null),
	]
		.filter(Boolean)
		.join(" · ");
}

function usage(entry) {
	const parts = [];
	const tokens = [
		entry.input_tokens,
		entry.cached_input_tokens,
		entry.output_tokens,
	];
	if (tokens.some(count))
		parts.push(`${tokens.filter(count).reduce((a, b) => a + b, 0)} tokens`);
	if (count(entry.cost_micro_usd)) parts.push(`${entry.cost_micro_usd} µUSD`);
	return parts.join(" · ");
}

// The selected frame and its timeline row describe the same recorded action.
function explanations(event, timelineRow = false) {
	const fields = element("dl", null, "explanations");
	for (const [key, label] of [
		["observation", "Observation"],
		["reason", "Reason"],
	]) {
		const value = element("dd", event?.[key] ?? "Not recorded");
		if (timelineRow) value.dataset.testid = `step-${key}`;
		fields.append(element("dt", label), value);
	}
	return fields;
}

function buildMoments(run) {
	const steps = list(run.steps);
	const actions = list(run.replay?.events).filter(
		(event) => event.type === "action",
	);
	const result = [];
	let nextStep = 0;
	// Capture and recording use different clocks. Match an executed target, then seek the source timestamp.
	for (const shot of list(run.replay?.screenshots)) {
		const actionIndex = actions.findIndex(
			(event) => event.action === shot.action,
		);
		const event = actionIndex >= 0 ? actions.splice(actionIndex, 1)[0] : null;
		const match = steps.findIndex(
			(step, i) =>
				i >= nextStep &&
				step.action === shot.action &&
				(step.t_s === shot.t_s ||
					(event?.detail &&
						[step.selector, step.target, `text=${step.target}`].includes(
							event.detail,
						))),
		);
		while (nextStep < match) {
			result.push({
				step: steps[nextStep],
				index: nextStep,
				time: steps[nextStep].t_s,
			});
			nextStep++;
		}
		if (match >= 0) {
			result.push({
				step: steps[match],
				index: match,
				time: steps[match].t_s,
				shot,
				event,
			});
			nextStep++;
		} else result.push({ shot, event, time: result.at(-1)?.time ?? 0 });
	}
	for (let i = nextStep; i < steps.length; i++)
		result.push({ step: steps[i], index: i, time: steps[i].t_s });
	return result;
}

function asset(name) {
	return Object.hasOwn(snapshot.assets, name) ? snapshot.assets[name] : null;
}

function showFrame(moment) {
	const frame = byId("frame");
	const shot = moment?.shot;
	if (!shot || !asset(shot.path)) {
		frame.replaceChildren(element("span", "No frame for this moment"));
		return;
	}
	const caption =
		actionText(moment.event ?? moment.step ?? shot) || "Screenshot";
	const image = element("img");
	image.src = asset(shot.path);
	image.alt = `Ember's browser at ${stamp(shot.t_s)}, ${caption}`;
	const marked = element("div", null, "marked-frame");
	marked.append(image, element("span", caption, "action-mark"));
	frame.replaceChildren(marked);
}

function selectMoment(index, seek = true) {
	selected = index;
	const moment = moments[index];
	const step = moment?.event ?? moment?.step ?? moment?.shot;
	const decision = byId("decision");
	if (moment) {
		const reported = { ...moment.event, ...moment.step };
		decision.replaceChildren(
			explanations(moment.event),
			element(
				"p",
				usage(reported) || "Step usage unreported",
				"decision-usage",
			),
		);
	} else
		decision.replaceChildren(
			element("p", "Waiting for an action.", "decision-empty"),
		);
	byId("active").textContent = step
		? actionText(step) || "Captured frame"
		: "Waiting for actions";
	byId("clock").textContent = stamp(moment?.time);
	byId("position").textContent = moment
		? `Moment ${index + 1} of ${moments.length}`
		: "";
	byId("prev").disabled = index <= 0;
	byId("next").disabled = index >= moments.length - 1;
	for (const button of byId("steps").querySelectorAll("button"))
		button.setAttribute("aria-current", String(Number(button.value) === index));
	if (seek && video && moment) {
		video.pause();
		video.currentTime = moment.time;
	}
	if (!video && snapshot) {
		const frames = list(snapshot.run.frames);
		const source =
			frames.findLast((f) => f.t_s <= (moment?.time ?? 0)) ?? frames[0];
		if (source && asset(source.path)) {
			const img = element("img");
			img.alt = `Reporter frame at ${stamp(source.t_s)}`;
			img.src = asset(source.path);
			byId("recording").replaceChildren(img);
		}
	}
	showFrame(moment);
}

function recording(run) {
	const url = asset(run.recording);
	if (video && video.getAttribute("src") === url) return;
	video = null;
	if (!url) {
		byId("recording").replaceChildren(element("span", "No recording yet"));
		return;
	}
	video = element("video");
	video.controls = true;
	video.playsInline = true;
	video.preload = "auto";
	video.setAttribute("aria-label", "Reporter recording");
	video.src = url;
	video.addEventListener("timeupdate", () => {
		if (!video || video.paused) return;
		const index = Math.max(
			0,
			moments.findLastIndex((m) => m.time <= video.currentTime),
		);
		if (index !== selected) selectMoment(index, false);
	});
	video.addEventListener(
		"loadedmetadata",
		() => {
			if (video && moments[selected])
				video.currentTime = moments[selected].time;
		},
		{ once: true },
	);
	byId("recording").replaceChildren(video);
}

function timeline(run) {
	const steps = list(run.steps);
	let subtotal = 0;
	const buttons = steps.map((step, i) => {
		const index = moments.findIndex((item) => item.index === i);
		const button = element("button", null, "step");
		button.value = index;
		button.addEventListener("click", () => selectMoment(index));
		const what = element("span");
		const reported = { ...moments[index].event, ...step };
		const charge = reported.cost_micro_usd;
		subtotal = count(subtotal) && count(charge) ? subtotal + charge : null;
		const labels = [usage(reported) || "Step usage unreported"];
		if (count(subtotal)) labels.push(`${subtotal} µUSD through step ${i + 1}`);
		what.append(
			element("strong", actionText(step)),
			element("small", labels.join(" · ")),
		);
		button.append(
			element("span", String(i + 1).padStart(2, "0"), "step-num"),
			what,
			element("span", stamp(step.t_s), "step-time"),
		);
		const row = element("li");
		row.dataset.testid = "replay-step";
		row.append(button, explanations(moments[index].event, true));
		return row;
	});
	byId("steps").replaceChildren(...buttons);
	byId("no-steps").hidden = Boolean(steps.length);
	byId("count").textContent =
		`${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
	const events = list(run.replay?.events);
	const rows = events.map((event) => {
		const row = element("p", null, "feed-line");
		row.append(
			element("span", event.t_s == null ? "—" : stamp(event.t_s), "meta"),
			element("strong", human(event.type)),
			document.createTextNode(
				` · ${[actionText(event), usage(event)].filter(Boolean).join(" · ")}`,
			),
		);
		return row;
	});
	byId("feed").dataset.eventCount = events.length;
	byId("feed").replaceChildren(
		...(rows.length ? rows : [empty("No browser events recorded.")]),
	);
}

function runnerLine(attempt) {
	const row = element("div");
	for (const [name, result] of [
		["Bug build", attempt?.bug],
		["Fixed build", attempt?.fixed],
	]) {
		if (!result) continue;
		const exit = result.exitCode;
		const outcome = exit == null ? "STOPPED" : exit === 0 ? "PASS" : "FAIL";
		const chip = element(
			"span",
			`${name} · ${outcome} · exit ${exit ?? "unknown"}`,
			"result",
		);
		chip.dataset.tone = exit === 0 ? "good" : "bad";
		row.append(chip);
	}
	if (!row.childElementCount) row.append(empty("No runner exits recorded"));
	return row;
}

function proofPanel({ run, proof, source }) {
	const section = byId("test");
	section.replaceChildren(
		element(
			"p",
			run.test?.path || "No regression test recorded.",
			"evidence-line",
		),
	);
	const attempts = list(proof?.attempts);
	byId("runners").replaceChildren(
		runnerLine(attempts.at(-1) ?? proof?.rerun_without_ember),
	);
	if (attempts.length > 1) {
		for (const attempt of attempts) {
			section.append(runnerLine(attempt), empty(human(attempt.reason)));
		}
	}
	if (source) section.append(element("pre", source));
}

function evidence(data) {
	const { run } = data;
	const pred = run.predicate;
	const shown = (v) => (typeof v === "string" ? v : JSON.stringify(v));
	byId("predicate").replaceChildren(
		...(pred
			? [
					pair("Expected", shown(pred.expected)),
					pair("Failure value", shown(pred.observed)),
					pair(
						human(pred.kind),
						pred.selector ??
							pred.message ??
							[pred.source, ...list(pred.path)].join("."),
					),
				]
			: [empty("No failure predicate recorded.")]),
	);
	// Watch's timestamped notes, shown as plain text.
	for (const id of ["uncertainty", "narration-evidence"]) {
		const notes = list(run[id.replace("-", "_")]).map((note) => {
			const item = element("li", null, "evidence-line");
			item.append(
				element("code", `${note.t_s}s`),
				element("span", ` ${note.text}`),
			);
			return item;
		});
		byId(id).replaceChildren(
			...(notes.length ? notes : [element("li", "None recorded.", "muted")]),
		);
	}
	const anchors = list(run.anchors).map((a) => {
		const anchor = element("p", null, "evidence-line");
		anchor.append(element("code", `${a.file}:${a.line}`));
		if (a.term) anchor.append(element("span", ` · ${a.term}`, "muted"));
		return anchor;
	});
	byId("anchors").replaceChildren(
		...(anchors.length ? anchors : [empty("No code anchor located.")]),
	);
	const cost = run.cost_micro_usd;
	const runCap = run.case_budget_micro_usd ?? run.cap_micro_usd;
	const cap = count(runCap) ? runCap : 9_000_000;
	const label = count(runCap) ? "Run cap" : "Project ceiling";
	const meter = byId("cost");
	meter.replaceChildren(
		element("p", count(cost) ? money(cost) : "Unreported", "amount"),
	);
	if (count(cost)) meter.append(element("span", ` · ${cost} µUSD`, "muted"));
	if (count(cap) && cap > 0 && count(cost)) {
		const gauge = element("meter");
		gauge.max = cap;
		gauge.value = Math.min(cost, cap);
		gauge.setAttribute(
			"aria-label",
			`Run spend as a share of ${label.toLowerCase()}`,
		);
		meter.append(gauge, empty(`${label} ${money(cap)}`));
	} else meter.append(empty(`${label} ${money(cap)}`));
	const candidates = list(data.candidates);
	byId("no-census").hidden = candidates.length > 0;
	byId("census").replaceChildren(
		...candidates.map(({ issue, status, href }) => {
			const row = element("li");
			row.dataset.testid = "census-row";
			const number = element(href ? "a" : "span", `#${issue}`);
			if (href) number.href = href;
			if (issue === run.issue) number.setAttribute("aria-current", "page");
			row.append(number, element("span", human(status)));
			return row;
		}),
	);
	proofPanel(data);
}

// Recorded steps can arrive before their browser frames. Follow the newest capture.
function latestCapture() {
	return Math.max(
		0,
		moments.findLastIndex((moment) => moment.shot),
	);
}

function draw(data) {
	const prior = moments[selected];
	const follow =
		(!snapshot && data.run.state === "finished") ||
		(live && (!snapshot || selected === latestCapture()));
	const focus = document.activeElement.closest("#steps button")?.value;
	snapshot = data;
	const { run } = data;
	moments = buildMoments(run);
	const title = run.title || run.steps?.[0]?.target || "Issue replay";
	byId("title").textContent = title;
	document.title = `${title} · Foley`;
	byId("issue").textContent = [
		`Issue #${run.issue}`,
		run.fixture ? "Synthetic fixture" : "",
		`rev ${run.target_revision.slice(0, 8)}`,
	]
		.filter(Boolean)
		.join("  /  ");
	status(
		run.state,
		run.state === "disconnected"
			? "Connection lost. Showing the last received run."
			: run.error,
	);
	byId("source-kind").textContent =
		run.recording?.split(".").at(-1) ?? (run.frames?.length ? "Frames" : "");
	const n = list(run.replay?.screenshots).length;
	byId("frame-count").textContent = `${n} ${n === 1 ? "frame" : "frames"}`;
	recording(run);
	timeline(run);
	evidence(data);
	const index = follow
		? latestCapture()
		: moments.findIndex(
				(m) => m.time === prior?.time && m.index === prior?.index,
			);
	selectMoment(Math.max(0, index), !prior || follow);
	if (focus != null)
		byId("steps")
			.querySelector(`button[value="${Number(focus)}"]`)
			?.focus({ preventScroll: true });
}
byId("prev").addEventListener("click", () => selectMoment(selected - 1));
byId("next").addEventListener("click", () => selectMoment(selected + 1));

// Cache received media as local blobs so scrubbing still works after disconnect.
async function receiveMedia(data, cache) {
	let complete = true;
	for (const [name, path] of Object.entries(data.assets)) {
		if (!cache.has(path)) {
			const response = await fetch(path);
			if (!response.ok) {
				delete data.assets[name];
				complete = false;
				continue;
			}
			cache.set(path, URL.createObjectURL(await response.blob()));
		}
		data.assets[name] = cache.get(path);
	}
	return complete;
}

async function refresh(previous, cache) {
	const response = await fetch("/run.json?view=replay", { cache: "no-store" });
	if (!response.ok) {
		const waiting = response.status === 404 && !snapshot;
		status(
			waiting ? "loading" : "error",
			waiting ? "Waiting for the first run record." : "Run data unavailable.",
		);
		return previous;
	}
	const text = await response.text();
	if (text === previous) {
		if (byId("state").textContent !== snapshot.run.state)
			status(snapshot.run.state, snapshot.run.error);
		return previous;
	}
	const data = JSON.parse(text);
	const complete = await receiveMedia(data, cache);
	draw(data);
	return complete ? text : null;
}

async function poll() {
	const cache = new Map();
	let previous;
	for (;;) {
		try {
			previous = await refresh(previous, cache);
		} catch {
			status(
				"disconnected",
				snapshot
					? "Connection lost. Showing the last received run."
					: "Connection lost before the first run record.",
			);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 750));
	}
}

if (live) {
	status("loading", "Waiting for the first run record.");
	void poll();
} else {
	draw(JSON.parse(byId("data").textContent));
}
