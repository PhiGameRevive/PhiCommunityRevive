<script lang="ts">
	import { onMount, onDestroy, tick as flush } from 'svelte';
	import StoryBackdrop from './StoryBackdrop.svelte';
	import { CUTSCENES } from './cutscenes';

	export let id: string;
	export let reducedMotion = false;
	export let horror = false;
	export let oncomplete: () => void;
	export let ontick: ((seconds: number) => void) | undefined = undefined;

	let currentId: string | undefined;
	let index = 0;
	let elapsed = 0;
	let paused = false;
	let summaryOpen = false;
	let hidden = false;
	let completed = false;
	let systemReducedMotion = false;
	let mounted = false;
	let lastAt = 0;
	let unreported = 0;
	let timer: number | undefined;
	let motionQuery: MediaQueryList | undefined;
	let playButton: HTMLButtonElement | undefined;
	const marks = [0, 1, 2, 3, 4];
	const seats = [-2, -1, 0, 1, 2];

	function definition(value: string) {
		return Object.prototype.hasOwnProperty.call(CUTSCENES, value) ? CUTSCENES[value] : undefined;
	}

	function reset(value: string) {
		currentId = value;
		index = 0;
		elapsed = 0;
		unreported = 0;
		paused = false;
		completed = false;
		summaryOpen = false;
		if (mounted) lastAt = performance.now();
	}

	function finish() {
		if (completed) return;
		completed = true;
		unreported = 0;
		oncomplete();
	}

	function next() {
		if (completed) return;
		const frames = definition(id)?.frames;
		if (!frames || index >= frames.length - 1) {
			finish();
			return;
		}
		index += 1;
		elapsed = 0;
		lastAt = performance.now();
	}

	async function seek(frame: number) {
		if (completed) return;
		index = frame;
		elapsed = 0;
		paused = false;
		summaryOpen = false;
		lastAt = performance.now();
		await flush();
		playButton?.focus();
	}

	function togglePause() {
		if (summaryOpen) {
			summaryOpen = false;
			paused = false;
		} else paused = !paused;
		lastAt = performance.now();
	}

	function toggleSummary() {
		summaryOpen = !summaryOpen;
		lastAt = performance.now();
	}

	function visibilityChanged() {
		hidden = document.hidden;
		// A hidden tab never leaves a gap to charge when it becomes visible again.
		lastAt = performance.now();
	}

	function preferenceChanged() {
		systemReducedMotion = motionQuery?.matches ?? false;
	}

	function tick() {
		const now = performance.now();
		const delta = Math.min(2, Math.max(0, (now - lastAt) / 1000));
		lastAt = now;
		if (document.hidden || hidden || paused || summaryOpen || completed) return;
		const frame = definition(id)?.frames[index];
		if (!frame) return;
		// Account only foreground playback, conservatively capping a stalled main thread.
		const active = Math.min(delta, Math.max(0, frame.seconds - elapsed));
		elapsed = Math.min(frame.seconds, elapsed + active);
		unreported = Math.min(2, unreported + active);
		if (unreported >= 1) {
			const seconds = unreported;
			unreported = 0;
			ontick?.(seconds);
		}
		if (elapsed >= frame.seconds) next();
	}

	function animate() {
		tick();
		if (mounted) timer = requestAnimationFrame(animate);
	}

	onMount(() => {
		mounted = true;
		hidden = document.hidden;
		lastAt = performance.now();
		motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		preferenceChanged();
		motionQuery.addEventListener('change', preferenceChanged);
		document.addEventListener('visibilitychange', visibilityChanged);
		timer = requestAnimationFrame(animate);
	});

	onDestroy(() => {
		mounted = false;
		if (timer !== undefined) cancelAnimationFrame(timer);
		motionQuery?.removeEventListener('change', preferenceChanged);
		if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibilityChanged);
	});

	$: if (id !== currentId) reset(id);
	$: cutscene = definition(id);
	$: frame = cutscene?.frames[index];
	$: motionReduced = reducedMotion || systemReducedMotion;
	$: stopped = paused || summaryOpen || hidden;
	// Every shot reaches a meaningful end state in its first few seconds; the rest is subtitle reading time.
	$: linear = motionReduced ? 1 : Math.min(1, elapsed / Math.min(5, (frame?.seconds ?? 10) * 0.45));
	$: p = linear * linear * (3 - 2 * linear);
	$: turn = horror && !motionReduced ? p : 1;
	$: speaker = id === 'C02' ? '栞' : id === 'C04' || (id === 'C09' && index === 0) ? '岑' : id === 'C06' && index > 0 && index < 4 ? '季' : id === 'C08' && index < 2 ? '白榆' : '';
	$: totalSeconds = cutscene?.frames.reduce((total, shot) => total + shot.seconds, 0) ?? 0;
	$: playedSeconds = (cutscene?.frames.slice(0, index).reduce((total, shot) => total + shot.seconds, 0) ?? 0) + elapsed;
</script>

<section class="cutscene" aria-label={cutscene ? `过场：${cutscene.title}` : '未知过场'}>
	<header>
		<div class="heading">
			<span class="eyebrow">余页 / {id}</span>
			<h2>{cutscene?.title ?? '没有找到此过场'}</h2>
		</div>
		<button class="skip" type="button" on:click={finish} disabled={completed}>跳过过场</button>
	</header>
	<div class="controls" role="group" aria-label="过场播放控制">
		<button bind:this={playButton} type="button" on:click={togglePause} disabled={completed || !frame}>{paused || summaryOpen ? '继续播放' : '暂停'}</button>
		<button type="button" on:click={next} disabled={completed}>{index < (cutscene?.frames.length ?? 0) - 1 ? '下一镜头' : '完成过场'}</button>
		<button type="button" aria-expanded={summaryOpen} on:click={toggleSummary}>{summaryOpen ? '收起摘要' : '完整摘要 / 回看'}</button>
		<span class="status" role="status">{completed ? '已结束' : hidden ? '切到后台 · 已暂停' : summaryOpen ? '阅读摘要 · 已暂停' : paused ? '已暂停' : motionReduced ? '低动态 · 自动播放' : '自动播放'}</span>
	</div>
	{#if cutscene && frame}
		{#if id === 'C03' || id === 'C05'}<p class="intensity">{id === 'C03' ? '本段包含观众转向与旧人物剪影。' : '本段包含重复剪影与墨水蔓延。'}{horror && !motionReduced ? '缓慢动作，无闪光。' : '使用低强度定格呈现相同事实。'}</p>{/if}
		{#if summaryOpen}
			<div class="summary" role="region" aria-label="完整剧情摘要与镜头回看">
				<h3>完整摘要</h3>
				<p>下列为本段全部叙事字幕。可直接跳过，也可从任一镜头回看。</p>
				<ol>
					{#each cutscene.frames as shot, shotIndex}<li>
							<h4>{shot.title}</h4>
							<p>{shot.text}</p>
							<button type="button" on:click={() => seek(shotIndex)} disabled={completed}>从第 {shotIndex + 1} 镜头播放</button>
						</li>{/each}
				</ol>
			</div>
		{:else}
			<div class="stage" class:quiet={motionReduced}>
				<div class="scenery"><StoryBackdrop region={frame.region} scene={index} {speaker} changed={index > 2} reducedMotion={motionReduced || stopped} /></div>
				<svg class="action" viewBox="0 0 960 540" preserveAspectRatio="xMidYMid meet" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
					<!-- The foreground is shot-specific, while the district remains a second architectural layer. -->
					{#if id === 'C00'}
						{#if index === 0}
							<g transform={`translate(0 ${30 * (1 - p)})`}
								><path d="M250 170H710V370H250V295Q280 275 250 255Z" fill="#d5d5d5" stroke="#eee" stroke-width="2" /><path d="M605 185V354" stroke="#666" stroke-dasharray="5 6" /><path
									d="M290 215H553M290 234H497M292 326H451"
									stroke="#555"
									stroke-width="3"
								/><circle cx="515" cy="282" r={34 * p} fill="#151515" /><path d="M430 65H550V150H430Z" fill="#333" stroke="#aaa" transform={`translate(0 ${70 * p})`} /><path
									d="M471 151h38v64h-38z"
									fill="#777"
									transform={`translate(0 ${45 * p})`}
								/></g
							>
						{:else if index === 1}
							<path d="M165 385L437 144H524L798 385" stroke="#eee" stroke-width="8" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - p} />
							{#each marks as x}<path d={`M${392 - x * 42} ${190 + x * 40}H${570 + x * 42}`} stroke="#999" stroke-width="5" opacity={Math.max(0, p * 5 - x)} />{/each}
							<path d="M435 283L285 210M524 283L674 210" stroke="#ccc" stroke-width="5" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - p} /><circle cx="479" cy="144" r="22" stroke="#ddd" stroke-width="4" />
						{:else if index === 2}
							<path d="M185 340L380 240H758L601 340Z" fill="#777" stroke="#ddd" /><g transform={`translate(0 ${340 * (1 - p)}) scale(1 ${Math.max(0.04, p)})`}
								><path d="M185 340V224H601V340Z" fill="#ccc" stroke="#eee" /><path d="M601 224L758 144V240L601 340Z" fill="#555" stroke="#ddd" />{#each marks as x}<rect
										x={214 + x * 73}
										y="246"
										width="49"
										height="54"
										fill="#222"
									/>{/each}<path d="M608 231L743 163V209L608 281Z" fill="#151515" /></g
							><path d={`M401 342L${365 + 36 * p} ${380 - 38 * p}H${505 - 36 * p}L469 342`} fill="#aaa" />
						{:else if index === 3}
							<path d="M165 392L464 131L794 330L495 462Z" fill="#333" stroke="#bbb" /><path d="M464 131L495 462" stroke="#eee" stroke-dasharray="7 7" />
							<g transform={`translate(${p * 125} ${-p * 60})`}
								><path d="M257 328V233H473L521 264V328Z" fill="#bbb" stroke="#eee" />{#each [0, 1, 2, 3] as x}<path d={`M${278 + x * 47} 250h31v43h-31z`} fill="#222" />{/each}</g
							><path d={`M464 131L${794 - p * 257} ${330 - p * 229}L${495 + p * 173} ${462 - p * 135}Z`} fill="#969696" stroke="#eee" />
						{:else}
							<path d="M170 384L480 203L790 384L480 473Z" fill="#555" stroke="#bbb" />{#each [{ x: 288, y: 363, h: 94 }, { x: 402, y: 321, h: 128 }, { x: 519, y: 325, h: 166 }, { x: 636, y: 372, h: 109 }] as b}<path
									d={`M${b.x} ${b.y}v-${b.h * p}l36-22 42 22v${b.h * p}l-42 24z`}
									fill="#aaa"
									stroke="#eee"
								/><path d={`M${b.x + 36} ${b.y - b.h * p + 22}v${b.h * p}`} stroke="#555" />{/each}<path d="M480 198V471" stroke="#eee" stroke-dasharray="10 9" stroke-width="3" /><path
								d="M497 452L539 419L552 432"
								stroke="#eee"
								stroke-width="4"
							/>
						{/if}
					{:else if id === 'C01'}
						<path d="M480 163V446" stroke="#aaa" stroke-width="10" />
						{#if index === 0}
							<g transform={`rotate(${-12 + 12 * p} 480 230)`}><path d="M281 180H661L703 230L661 280H281Z" fill="#d5d5d5" /><path d="M313 212H610M313 244H557" stroke="#333" stroke-width="5" /></g><circle
								cx="480"
								cy="189"
								r={19 + 12 * p}
								stroke="#888"
								stroke-width="5"
								opacity={1 - p * 0.8}
							/>
						{:else if index === 1}
							<path d="M281 180H661L703 230L661 280H281Z" fill="#d5d5d5" /><path d="M313 212H610M313 244H557" stroke="#333" stroke-width="5" /><path d="M260 433H573L694 322" stroke="#aaa" stroke-width="3" /><g
								transform={`translate(${p * 267} ${-p * 40})`}><path d="M243 374h74v37h-74z" fill="#bbb" /><circle cx="254" cy="416" r="9" fill="#eee" /><circle cx="307" cy="416" r="9" fill="#eee" /></g
							>
						{:else if index === 2}
							<path d="M281 180H661L703 230L661 280H281Z" fill="#ddd" /><path d="M313 212H610M313 244H557" stroke="#333" stroke-width="5" /><path d="M265 325H698V390H348L315 414V390H265Z" fill="#181818" stroke="#aaa" /><path
								d="M290 353H461"
								stroke="#ddd"
								stroke-width="4"
							/><path d="M486 353H663" stroke="#ddd" stroke-width="4" opacity={1 - p} /><path d="M486 367H663" stroke="#888" stroke-dasharray="4 7" />
						{:else if index === 3}
							<g transform={`translate(0 ${35 * (1 - p)})`}
								><path d="M246 186L481 207L715 186V390L481 414L246 390Z" fill="#ccc" stroke="#eee" /><path d="M481 207V414" stroke="#666" />{#each marks as y}<path
										d={`M272 ${224 + y * 32}l178 16M510 ${240 + y * 32}l178-16`}
										stroke="#555"
										stroke-width="3"
									/>{/each}<path d="M506 281L693 262V305L506 324Z" stroke="#111" stroke-width="3" /></g
							>
						{:else}
							<path d="M480 423V302L286 167M480 302V155M480 302L683 167" stroke="#ddd" stroke-width="5" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - p} />{#each [280, 480, 680] as x}<rect
									x={x - 39}
									y="123"
									width="78"
									height="68"
									fill="#333"
									stroke="#ddd"
								/><path d={`M${x - 21} 144h42m-42 16h42`} stroke="#aaa" />{/each}<circle cx="480" cy="302" r="15" fill="#ddd" />
						{/if}
					{:else if id === 'C02'}
						{#if index === 0}
							<path d="M252 159H714V361H252Z" fill="#343434" stroke="#aaa" /><g transform={`translate(0 ${p * 52})`}
								><path d="M269 268H697L747 338V387H219V338Z" fill="#777" stroke="#ddd" /><path d="M293 220H463V328H293ZM501 235H670V328H501Z" fill="#ccc" stroke="#555" /><path d="M453 354h58v15h-58z" stroke="#eee" /></g
							>
						{:else if index === 1}
							{#each [-1, 1] as side}<g transform={`translate(${side * (40 + 58 * p)} 0)`}
									><path d="M397 188H564V386H397Z" fill="#ddd" stroke="#777" /><path d="M414 225h132m-132 28h105m-105 28h124m-124 28h101" stroke="#666" stroke-width="3" /><path
										d={`M397 188L${397 - 38 * p} ${204 + 5 * p}V385L397 386`}
										fill="#999"
										stroke="#ddd"
									/></g
								>{/each}
						{:else if index === 2}
							{#each [0, 1] as x}<path d={`M${260 + x * 284} 160h159v155h-159z`} fill="#ccc" /><path d={`M${277 + x * 284} 185h121m-121 24h104m-104 24h119`} stroke="#555" /><path
									d={`M${340 + x * 284} 316v50h${x ? -49 : 49}v46`}
									stroke="#ddd"
									stroke-width="3"
									pathLength="1"
									stroke-dasharray="1"
									stroke-dashoffset={1 - p}
								/><path d={`M${302 + x * 194} 400h151v52h-151z`} fill="#777" stroke="#eee" /><circle cx={324 + x * 194} cy="426" r="9" stroke="#eee" />{/each}
						{:else if index === 3}
							{#each [0, 1] as x}<path d={`M${287 + x * 240} 168h152v233h-152z`} fill="#ccc" /><path d={`M${323 + x * 240} 305v${91 * p}l24-17 24 17v-${91 * p}z`} fill="#444" stroke="#eee" /><path
									d={`M${308 + x * 240} 202h109m-109 28h92m-92 28h108`}
									stroke="#555"
								/>{/each}<path d="M456 192V385" stroke="#aaa" stroke-dasharray="5 8" />
						{:else}
							<path d="M240 152H720V400H240Z" fill="#292929" stroke="#aaa" /><g transform={`translate(0 ${45 * (1 - p)})`}
								><path d="M259 204H701V378H259Z" fill="#666" stroke="#ddd" /><path d="M314 180H426V315L370 285L314 315ZM534 180H646V315L590 285L534 315Z" fill="#ddd" stroke="#333" /><path d="M441 336h77v19h-77z" stroke="#eee" /></g
							><path d="M336 218h64m-64 18h42M556 218h64m-64 18h42" stroke="#555" />
						{/if}
					{:else if id === 'C03'}
						<path d="M198 143H764V328H198Z" stroke="#aaa" /><path d="M160 345H800M192 323H768" stroke="#ddd" stroke-width="3" />
						{#each seats as x}<path d={`M${451 + x * 111} 412q0-32 29-32t29 32v41h-58z`} fill="#1a1a1a" stroke="#aaa" /><ellipse
								cx={480 + x * 111}
								cy="385"
								rx={index >= 2 ? 19 + 5 * turn : 19}
								ry="25"
								fill={index >= 2 ? '#aaa' : '#444'}
							/>{#if index >= 2}<path d={`M${471 + x * 111} 382h3m12 0h3`} stroke="#111" stroke-width="4" opacity={turn} />{/if}{/each}
						{#if index === 0}
							<g transform={`rotate(${p * 18} 480 309)`}><circle cx="480" cy="231" r="20" fill="#ccc" /><path d="M460 253L442 314H518L500 253Z" fill="#555" stroke="#ccc" /></g><path
								d="M578 144V285"
								stroke="#aaa"
								stroke-dasharray="142"
								stroke-dashoffset={80 * p}
							/>
						{:else if index === 1}
							<path d="M451 254L434 311H514L497 254Z" fill="#999" opacity={1 - p} /><circle cx="475" cy="233" r="19" fill="#999" opacity={1 - p} /><path d="M541 219H708V276H587L566 295V276H541Z" fill="#ddd" /><path
								d="M558 239H689M558 254H655"
								stroke="#444"
								stroke-width="3"
							/>
						{:else if index === 2}
							<path d="M266 180H696V274H266Z" stroke="#666" /><path d="M337 233L362 218V248ZM623 233L598 218V248Z" fill="#bbb" opacity={turn} /><path d="M435 233H525" stroke="#999" />
						{:else if index === 3}
							<g transform={`translate(480 416) scale(${0.72 + 0.28 * turn}) translate(-480 -416)`}
								><path d="M446 220Q433 163 476 156Q524 154 518 220L511 246H451Z" fill="#090909" stroke="#aaa" /><path d="M447 248L419 399H541L512 248Z" fill="#111" stroke="#bbb" /><path d="M458 250L450 375H511L500 250Z" fill="#777" /><path
									d="M453 198h21v13h-21zm31 0h21v13h-21zm-10 6h10"
									stroke="#ddd"
								/></g
							><path d="M480 145V157" stroke="#aaa" />
						{:else}
							<path d="M480 148V230L339 297M480 230L620 297" stroke="#ddd" stroke-width="3" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - p} />{#each [276, 556] as x}<path d={`M${x} 267h128v91H${x}z`} fill="#ccc" /><path
									d={`M${x + 16} 287h95m-95 19h72m-72 19h87`}
									stroke="#555"
								/>{/each}<circle cx="480" cy="230" r="11" fill="#ddd" />
						{/if}
					{:else if id === 'C04'}
						{#if index === 0}
							<circle cx="480" cy="236" r="113" stroke="#777" stroke-width="12" /><g transform={`rotate(${-18 * (1 - p)} 480 142)`}
								><path d="M480 142V337" stroke="#ddd" stroke-width="7" /><circle cx="480" cy="359" r="35" fill="#aaa" stroke="#eee" /></g
							><path d="M620 213h55v25h-55z" fill="#ddd" transform={`translate(${-p * 58} 0)`} />
						{:else if index === 1}
							<circle cx="349" cy="243" r="75" stroke="#999" /><path d="M349 169V316" stroke="#bbb" stroke-width="5" /><path d={`M432 196H${454 + 244 * p}V367H432Z`} fill="#ccc" />{#each marks as y}<path
									d={`M450 ${215 + y * 31}h${Math.max(0, 193 * p - y * 6)}`}
									stroke="#777"
								/>{/each}<circle cx="618" cy="340" r={19 * p} fill="#333" /><path d="M609 340l7 7 15-16" stroke="#ddd" stroke-width="3" opacity={p} />
						{:else if index === 2}
							{#each [-1, 1] as x}<circle cx="480" cy={277 + x * 98} r="27" fill="#aaa" /><path d={`M${286} ${277 + x * 98}H480L${668} 277`} stroke="#ddd" stroke-width="4" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - p} /><path
									d={`M263 ${259 + x * 98}h32v36h-32z`}
									stroke="#eee"
								/>{/each}<rect x="668" y="251" width="51" height="51" fill="#ccc" />
						{:else if index === 3}
							<path d="M247 201H710M247 343H710" stroke="#666" stroke-width="4" /><path d="M247 201H709M247 343H490" stroke="#ddd" stroke-width="4" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - p} /><path
								d="M490 155H523V393H490Z"
								fill="#777"
								stroke="#ddd"
							/><path d="M490 183h33v36h-33z" fill="#111" /><path d="M663 156H741V247H663ZM663 300H741V391H663Z" stroke="#aaa" /><circle cx="477" cy="343" r="11" fill="#ddd" opacity={p} />
						{:else}
							{#each [0, 1] as x}<g transform={`translate(${(x ? 1 : -1) * 22 * p} 0)`}
									><path d={`M${310 + x * 204} 147h148v256h-148z`} fill="#ccc" />{#each marks as y}<path d={`M${329 + x * 204} ${182 + y * 43}h104`} stroke="#777" /><circle
											cx={344 + x * 204}
											cy={182 + y * 43}
											r="6"
											fill={x === 1 && y === 4 ? '#ccc' : '#222'}
											stroke="#222"
										/>{/each}</g
								>{/each}<path d="M296 373H688" stroke="#eee" stroke-dasharray="3 7" />
						{/if}
					{:else if id === 'C05'}
						{#if index === 0}
							<path d="M223 165H737V399H223Z" fill="#aaa" /><path d="M270 210H387V399H270ZM566 210H683V399H566Z" fill="#222" /><path
								d={`M223 ${399 - 105 * turn}Q440 ${376 - 95 * turn} 737 ${399 - 105 * turn}V399H223Z`}
								fill="#080808"
								stroke="#aaa"
							/><path d={`M223 399L${223 + 123 * turn} ${399 - 63 * turn}L${223 + 91 * turn} 399Z`} fill="#ddd" />
						{:else if index === 1 || index === 2}
							{#each index === 1 ? [0] : [-1, 0, 1] as x}<g transform={`translate(${x * 210} 0)`}
									><path d="M406 167H554V405H406Z" fill="#333" stroke="#bbb" /><path d="M422 186H538V405H422Z" fill="#080808" /><g opacity={index === 1 ? 1 : Math.min(1, 0.4 + turn)}
										><circle cx="480" cy="248" r="23" fill="#777" /><path d="M457 272L438 399H522L503 272Z" fill="#111" stroke="#aaa" /><path d="M465 277L457 370H503L495 277Z" fill="#666" /></g
									><path d="M426 137h108v43H426Z" fill="#ccc" /><path d="M439 152h80m-80 13h65" stroke="#555" /></g
								>{/each}<path d="M182 411H778" stroke="#aaa" />
						{:else if index === 3}
							{#each marks as x}<g transform={`translate(${240 + (x % 3) * 167} ${158 + Math.floor(x / 3) * 109})`} opacity={horror && !motionReduced ? Math.min(1, p * 4 + 0.2 - x * 0.18) : 1}
									><path d="M0 0H150V67H65L47 83V67H0Z" fill="#c5c5c5" /><path d="M13 20H133M13 39H118M13 54H88" stroke="#444" stroke-width="3" /><path
										d={`M75 84L${470 - (240 + (x % 3) * 167)} ${413 - (158 + Math.floor(x / 3) * 109)}`}
										stroke="#bbb"
									/></g
								>{/each}<path d="M442 401h66v44h-66z" fill="#aaa" />
						{:else}
							{#each marks as x}<path d={`M${264 + x * 107} 157L480 301V420`} stroke="#999" stroke-width="3" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - p} />{/each}<path d="M448 280H512V308H448Z" fill="#ddd" /><path
								d="M406 393H554V425H406Z"
								fill="#444"
								stroke="#ddd"
							/><path d="M438 427Q480 441 522 427M417 443Q480 462 543 443" stroke="#aaa" />
						{/if}
					{:else if id === 'C06'}
						<path d="M170 421H789M228 446H735M283 468H680" stroke="#777" /><path d="M275 394L396 287H562L686 394Z" fill="#3d3d3d" stroke="#aaa" />
						{#if index === 0}
							{#each marks as x}<g opacity={Math.max(0, 1 - p * 5 + x)}><path d={`M${231 + x * 111} 166h93v58h-93z`} fill="#bbb" /><path d={`M${243 + x * 111} 187h68m-68 16h54`} stroke="#444" /></g>{/each}<path
								d="M452 232h63v99h-63z"
								fill="#555"
								stroke="#aaa"
							/><path d="M465 247h37v15h-37z" fill="#ccc" transform={`translate(0 ${p * 48})`} />
						{:else if index === 1}
							<g transform={`translate(${p * 37} 0)`}><path d="M366 185H437V320H366Z" fill="#303030" stroke="#bbb" /><path d="M350 322H450V342H350ZM366 342V382M436 342V382" fill="#777" stroke="#bbb" /></g><path
								d="M518 266H611V365H518Z"
								fill="#ccc"
							/><path d="M532 286h65m-65 18h65m-65 18h47" stroke="#555" />
						{:else if index === 2}
							<path d="M321 130H611V365H321Z" fill="#ddd" stroke="#999" /><path d="M344 159h174m-174 29h229m-229 29h229m-229 29h201m-201 29h228" stroke="#555" stroke-width="3" /><path
								d="M342 319H588"
								stroke="#444"
								stroke-width="3"
								pathLength="1"
								stroke-dasharray="1"
								stroke-dashoffset={1 - p}
							/><circle cx="557" cy="319" r={17 * p} stroke="#333" stroke-width="3" /><path d="M342 308V331" stroke="#444" />
						{:else if index === 3}
							<path d="M319 226H624L677 324H265Z" fill="#777" stroke="#bbb" /><g transform={`translate(475 265) scale(1 ${Math.max(0.08, Math.abs(1 - p * 2))}) translate(-475 -265)`}
								><path d="M393 212H559V304H393Z" fill={p > 0.5 ? '#555' : '#ddd'} stroke="#bbb" />{#if p < 0.5}<path d="M413 237H537M413 259H513" stroke="#555" />{/if}</g
							>
						{:else}
							<path d="M370 203H442V323H370Z" fill="#333" stroke="#bbb" /><path d="M354 325H454V345H354ZM370 345V384M438 345V384" fill="#777" stroke="#bbb" /><g transform={`translate(${p * 110} ${p * 20})`}
								><path d="M501 236H589V353H501Z" fill="#ccc" /><path d="M515 260h60m-60 18h60m-60 18h47" stroke="#555" /></g
							><path d="M482 445h126" stroke="#bbb" />
						{/if}
					{:else if id === 'C07'}
						{#if index === 0}
							<path d="M233 153H485V406H233Z" fill="#555" stroke="#ccc" /><path d={`M485 153L${735 - 150 * p} ${153 - 26 * p}V${406 - 26 * p}L485 406Z`} fill="#aaa" stroke="#eee" /><path
								d="M485 143V422"
								stroke="#eee"
								stroke-dasharray="7 7"
							/>{#each marks as y}<path d={`M263 ${183 + y * 43}h${175 - (y % 2) * 44}`} stroke="#ccc" stroke-width="3" opacity={p} />{/each}
						{:else if index === 1}
							<path d="M212 162H397V396H212Z" fill="#ccc" />{#each marks as x}<path
									d={`M235 ${190 + x * 42}h130M398 ${190 + x * 42}L${580 + (x % 3) * 56} ${333 - (x % 3) * 51}`}
									stroke={x % 2 ? '#777' : '#aaa'}
									stroke-width="2"
									pathLength="1"
									stroke-dasharray="1"
									stroke-dashoffset={1 - p}
								/>{/each}<path d="M552 374V255L593 222L635 255V374ZM641 374V172H690V374ZM694 374V293L736 254L777 293V374Z" fill="#777" stroke="#ddd" />
						{:else if index === 2}
							<path d="M258 175H419V245H258ZM258 321H419V391H258ZM580 211H726V355H580Z" fill="#ccc" /><path d="M277 197h122m-122 24h92M277 343h122m-122 24h92" stroke="#555" /><path
								d="M419 210H513V278H580"
								stroke="#ddd"
								stroke-width="4"
							/><path d="M419 356H478V307H580" stroke="#ddd" stroke-width="4" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - p} /><path d="M500 321L529 350M529 321L500 350" stroke="#ddd" stroke-width="4" />
						{:else if index === 3}
							<path d="M226 202H415V326H226ZM545 202H734V326H545Z" fill="#bbb" stroke="#eee" /><path d="M251 240H389M251 263H370M251 286H389M570 240H708M570 263H689M570 286H708" stroke="#555" stroke-width="3" /><path
								d="M447 251H513M447 277H513"
								stroke="#eee"
								stroke-width="6"
								transform={`translate(0 ${p * 122})`}
								opacity={1 - p * 0.5}
							/>
						{:else}
							<path d={`M${202 + p * 124} ${137 + p * 43}H${758 - p * 124}V${420 - p * 43}H${202 + p * 124}Z`} fill="#222" stroke="#ccc" stroke-width="3" /><path
								d="M378 224h204m-204 30h157m-157 30h204m-204 30h176"
								stroke="#aaa"
								stroke-width="3"
							/><path d={`M203 267H${325 + p * 20}M${635 - p * 20} 267H757`} stroke="#ddd" /><circle cx="211" cy="267" r="12" fill="#ccc" /><circle cx="749" cy="267" r="12" fill="#ccc" />
						{/if}
					{:else if id === 'C08'}
						{#if index === 0}
							<path d="M230 193L472 158L723 195V374L479 411L230 374Z" fill="#aaa" stroke="#ddd" /><path d="M474 160L479 411" stroke="#666" /><path
								d="M276 323L354 223L440 288L526 212L665 301L610 354L533 305L454 370L369 298Z"
								stroke="#444"
								stroke-width="4"
							/><path d="M277 350L662 258" stroke="#eee" stroke-width="3" stroke-dasharray="6 8" /><path d="M269 214h120v30H269Z" fill="#333" opacity={p} />
						{:else if index === 1}
							<path d="M208 351L407 222H560L751 351M251 404L432 288H541L708 404" stroke="#ccc" stroke-width="4" />{#each marks as x}<path
									d={`M${281 + x * 85} ${322 - (2 - Math.abs(x - 2)) * 47}l38-25 31 35-40 28z`}
									fill="#aaa"
									stroke="#eee"
									transform={`translate(0 ${-60 * Math.max(0, 1 - p * 5 + x)})`}
									opacity={Math.max(0, p * 5 - x + 0.3)}
								/>{/each}<path d="M400 423h162" stroke="#ddd" />
						{:else if index === 2}
							{#each [-1, 1] as side}<g transform={`translate(${side * 73 * p} 0)`}
									><path d={`M${side < 0 ? 318 : 483} 180h159v207h-159z`} fill="#aaa" stroke="#ddd" /><path d={`M${side < 0 ? 350 : 514} 224h95v162h-95z`} fill="#222" /><path
										d={`M${side < 0 ? 360 : 524} 163h75v60l-37-19-38 19z`}
										fill="#ddd"
										stroke="#555"
									/></g
								>{/each}<path d="M480 152V419" stroke="#aaa" stroke-dasharray="6 9" />
						{:else if index === 3}
							<path d="M231 190H729V359H231Z" fill="#222" stroke="#aaa" /><path d="M231 274H729M333 190V359M435 190V359M537 190V359M639 190V359" stroke="#666" />{#each marks as x}<rect
									x={245 + x * 101}
									y={x % 2 ? 292 : 208}
									width="70"
									height="47"
									fill="#bbb"
								/>{/each}<path d="M254 389H707" stroke="#ddd" stroke-width="3" /><circle cx={254 + 453 * p} cy="389" r="8" fill="#eee" />
						{:else}
							<path d="M222 368L479 202L738 368M254 410L479 264L706 410" stroke="#ddd" stroke-width="5" /><path d="M388 260L413 298M548 260L573 298" stroke="#eee" stroke-width="9" /><g
								transform={`translate(${291 + p * 330} ${337 - Math.sin(p * Math.PI) * 109})`}><path d="M-25-34H25V0H-25Z" fill="#ccc" /><circle cx="-17" cy="6" r="7" fill="#eee" /><circle cx="17" cy="6" r="7" fill="#eee" /></g
							><path d="M692 288h66v56h-66z" fill="#bbb" /><path d="M707 306h38m-38 17h26" stroke="#444" />
						{/if}
					{:else if id === 'C09'}
						{#if index === 0}
							<path d="M250 160H415V375H250ZM573 160H708V375H573Z" fill="#333" stroke="#bbb" /><path d="M269 186h126m-126 31h126m-126 31h98M593 186h95m-95 31h72" stroke="#aaa" /><path
								d={`M415 276H${494 - p * 36}V${276 + p * 79}`}
								stroke="#ddd"
								stroke-width="6"
							/><path d="M548 259H573V293H548Z" stroke="#ddd" /><path d={`M${482 - p * 36} ${263 + p * 79}h25v26h-25z`} fill="#bbb" />
						{:else if index === 1}
							<path d="M301 134H662V429H301Z" fill="#222" stroke="#ccc" /><path d="M334 169H627V393H334Z" fill="#111" /><path d="M352 218H611M352 281H611M352 344H611" stroke="#777" />{#each marks as x}<path
									d={`M${365 + x * 47} 178v37m0 24v38m0 27v35`}
									stroke="#555"
									stroke-width="14"
								/>{/each}<path d={`M301 134L${649 - 215 * p} ${134 + 53 * p}V${429 - 16 * p}L301 429Z`} fill="#555" stroke="#ddd" /><path d={`M${609 - 181 * p} ${275 + p * 17}v33`} stroke="#ccc" stroke-width="5" />
						{:else if index === 2}
							<path d="M262 180H697V379H262Z" fill="#ccc" /><path d="M290 219H669M290 258H669M290 297H669M290 336H669M448 204V355" stroke="#777" /><path d="M311 238h93m-93 39h77m-77 39h89" stroke="#333" stroke-width="3" /><path
								d="M470 231H646V349H470Z"
								stroke="#444"
								stroke-dasharray="4 7"
							/><path d="M276 397H683" stroke="#aaa" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - p} />
						{:else if index === 3}
							<path d="M321 135H640V419H321Z" fill="#555" stroke="#aaa" /><path d="M367 176H594V370H367Z" fill="#ddd" /><path d="M389 205h182m-182 29h155m-155 29h182m-182 29h179m-179 29h120" stroke="#555" stroke-width="3" /><path
								d={`M594 370L${560 + 34 * p} 370L594 ${336 + 34 * p}Z`}
								fill="#888"
							/><circle cx="480" cy="161" r="5" fill="#ccc" />
						{:else}
							<path d="M271 164H690V396H271Z" fill="#171717" stroke="#aaa" /><path d="M297 310H665V341H297Z" fill="#777" /><path d="M330 341V396M631 341V396" stroke="#aaa" stroke-width="7" /><path
								d={`M${352 - p * 97} 297h104v97H${352 - p * 97}z`}
								fill="#444"
								stroke="#999"
							/><path d="M479 165L369 396H631L569 165Z" fill="#ddd" opacity={0.05 + 0.13 * p} /><path d="M410 271h85" stroke="#ccc" />
						{/if}
					{:else if id === 'C10'}
						<path d="M204 121H756V435H204Z" fill="#a9a9a9" /><path d="M222 139H738V417H222Z" stroke="#777" />
						{#if index === 0}
							<path d="M321 153V407M639 153V407" stroke="#333" stroke-width="3" stroke-dasharray="5 6" /><path d="M370 168H590V389H370Z" fill="#ccc" stroke="#555" transform={`translate(${90 * p} 0)`} /><path
								d="M267 161H316V401H267Z"
								fill="#444"
							/><path d="M328 218H486M328 330H486" stroke="#222" stroke-width="7" transform={`translate(${-p * 15} 0)`} /><path d="M613 155H694V409H613Z" stroke="#333" stroke-width="4" />
						{:else if index === 1}
							{#each [0, 1] as x}<g transform={`translate(${(x ? 1 : -1) * p * 27} 0)`}
									><path d={`M${304 + x * 192} 178h148v194h-148z`} fill="#ddd" stroke="#555" /><path d={`M${330 + x * 192} 162h97v79l-49-22-48 22z`} fill="#444" /><path
										d={`M${330 + x * 192} 273h97m-97 25h74m-74 25h97`}
										stroke="#777"
									/></g
								>{/each}<path d="M467 254h26m-26 17h26" stroke="#555" />
						{:else if index === 2}
							<path d="M274 166H468V383H274ZM507 166H701V383H507Z" fill="#ddd" stroke="#555" /><path d="M294 214L350 182L382 249L449 199M529 263L555 222L602 264L641 202L681 234" stroke="#666" stroke-width="3" /><path
								d="M292 317h153v40H292Z"
								fill="#777"
							/><path d="M531 331l17-8 7 13 19-27 8 20 35-3" stroke="#333" stroke-width="3" pathLength="1" stroke-dasharray="1" stroke-dashoffset={1 - p} /><path d="M487 167V383" stroke="#777" stroke-dasharray="6 8" />
						{:else if index === 3}
							<path d="M278 179H436V374H278Z" fill="#ddd" /><path d="M296 206h122m-122 25h101m-101 25h122m-122 25h94" stroke="#555" /><path d="M513 178H686V374H513Z" fill="#444" stroke="#222" /><path
								d="M532 199H667V350H532Z"
								stroke="#aaa"
								stroke-dasharray="4 8"
							/><path d="M436 311H502" stroke="#555" stroke-width="3" /><path d="M463 302l9 9-9 9" stroke="#333" stroke-width="3" /><path d="M562 389h17l10 9 26-27" stroke="#333" stroke-width="4" opacity={p} />
						{:else}
							<path d={`M${365 - p * 142} 106V449M${595 + p * 142} 106V449M188 ${228 - p * 89}H772M188 ${329 + p * 89}H772`} stroke="#333" stroke-width="3" /><path d="M392 215H568V342H392Z" fill="#333" stroke="#ddd" /><path
								d="M419 242h121m-121 25h100m-100 25h121m-121 25h86"
								stroke="#ccc"
							/><path d="M192 121h31v-27M737 94v27h31M192 435h31v27M737 462v-27h31" stroke="#eee" stroke-width="3" />
						{/if}
					{:else if id === 'C11'}
						{#if index === 0}
							<path d="M213 166L475 132L737 166V400L475 434L213 400Z" fill="#aaa" stroke="#ddd" /><path
								d="M272 344L352 235L460 302L586 206L686 270"
								stroke="#333"
								stroke-width="6"
								pathLength="1"
								stroke-dasharray="1"
								stroke-dashoffset={1 - p}
							/><path d="M242 190h108v40H242Z" fill="#ddd" /><path d="M541 337h159v42H541Z" fill="#555" /><path d="M557 351h126m-126 15h98" stroke="#ccc" />
						{:else if index === 1}
							<path d="M266 141H694V420H266Z" fill="#ccc" />{#each marks as x}<path d={`M292 ${179 + x * 48}h116`} stroke="#777" stroke-width="3" /><path
									d={`M452 ${179 + x * 48}l14-8 11 15 19-26 15 20 26-5 20 4 36-7`}
									stroke="#333"
									stroke-width="3"
									pathLength="1"
									stroke-dasharray="1"
									stroke-dashoffset={Math.max(0, 1 - p * 5 + x)}
								/>{/each}<path d="M430 160V397" stroke="#999" />
						{:else if index === 2}
							<path d="M251 161H709V385H251Z" fill="#777" stroke="#ccc" /><path d="M392 183H568V385H392Z" fill="#111" stroke="#aaa" /><path d="M274 190h91v102h-91zM595 190h91v102h-91z" fill="#222" /><path
								d={`M392 385L${392 - 52 * p} ${385 + 47 * p}H${568 + 52 * p}L568 385Z`}
								fill="#ccc"
							/><g transform={`translate(${p * 115} ${-p * 26})`}><path d="M232 346H369V411H232Z" fill="#ddd" /><circle cx="337" cy="376" r="13" fill="#222" /></g>
						{:else if index === 3}
							<path d="M214 366L480 186L746 366L480 446Z" fill="#ccc" stroke="#eee" />{#each [{ x: 313, h: 91 }, { x: 415, h: 133 }, { x: 513, h: 168 }, { x: 612, h: 112 }] as b}<path
									d={`M${b.x} 351v-${b.h * (1 - p)}l28-17 32 17v${b.h * (1 - p)}l-32 19z`}
									fill="#777"
									stroke="#eee"
								/>{/each}<path d="M355 338L480 259L607 338M386 354L480 294L576 354" stroke="#555" opacity={p} />
						{:else}
							<path d="M260 143H700V418H260Z" fill="#ddd" stroke="#eee" /><path d="M298 180h244m-244 28h299m-299 28h213m-213 28h173" stroke="#777" stroke-width="3" /><path
								d={`M700 418L${700 - 86 * p} 418L700 ${418 - 86 * p}Z`}
								fill="#888"
								stroke="#666"
							/><path d="M583 321v-21h22M583 362v21h22" stroke="#777" /><path d="M293 399H400" stroke="#999" />
						{/if}
					{/if}
					<path d="M80 100V80H100M860 80H880V100M80 440V460H100M860 460H880V440" stroke="#bbb" opacity="0.6" />
				</svg>
				<div class="shot-label" aria-hidden="true"><span>分镜 {String(index + 1).padStart(2, '0')}</span><span>{id} / {String(cutscene.frames.length).padStart(2, '0')}</span></div>
			</div>
			<div class="caption" aria-live="polite" aria-atomic="true">
				<h3><span>{index + 1} / {cutscene.frames.length}</span>{frame.title}</h3>
				<p>{frame.text}</p>
			</div>
		{/if}
		<footer>
			<progress max={frame.seconds} value={elapsed} aria-label={`第 ${index + 1} 镜头播放进度`}></progress><span class="time"
				>{Math.floor(playedSeconds / 60)}:{String(Math.floor(playedSeconds % 60)).padStart(2, '0')} / {Math.floor(totalSeconds / 60)}:{String(totalSeconds % 60).padStart(2, '0')}</span
			><span>可随时推进，不必等待</span>
		</footer>
	{:else}
		<p class="missing">配置中没有编号为「{id}」的过场。可使用上方“跳过过场”继续。</p>
	{/if}
</section>

<style>
	.cutscene {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		color: #ededed;
		background: #151515;
		border: 1px solid #606060;
		border-radius: 3px;
		overflow: hidden;
		font: inherit;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.1rem 1.25rem 0.75rem;
	}
	.heading {
		min-width: 0;
	}
	.eyebrow {
		color: #aaa;
		font-size: 0.68rem;
		letter-spacing: 0.2em;
	}
	h2 {
		margin: 0.3rem 0 0;
		font-size: clamp(1.15rem, 2vw, 1.6rem);
		font-weight: 500;
		letter-spacing: 0.06em;
		overflow-wrap: anywhere;
	}
	button {
		min-height: 44px;
		padding: 0.6rem 0.85rem;
		color: #eee;
		background: #262626;
		border: 1px solid #777;
		border-radius: 3px;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		touch-action: manipulation;
	}
	button:hover {
		color: #111;
		background: #eee;
		border-color: #eee;
	}
	button:focus-visible {
		outline: 3px solid #fff;
		outline-offset: -4px;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.skip {
		flex-shrink: 0;
		color: #171717;
		background: #e0e0e0;
		border-color: #e0e0e0;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		padding: 0 1.25rem 1rem;
	}
	.status {
		margin-left: auto;
		font-size: 0.75rem;
		color: #bbb;
	}
	.intensity {
		margin: 0;
		padding: 0.65rem 1.25rem;
		color: #ccc;
		background: #202020;
		border-top: 1px solid #444;
		font-size: 0.8rem;
		line-height: 1.7;
	}
	.stage {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		max-height: 480px;
		min-height: 210px;
		background: #111;
		overflow: hidden;
		isolation: isolate;
	}
	.scenery {
		position: absolute;
		inset: 0;
		opacity: 0.4;
	}
	.action {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		filter: drop-shadow(0 7px 8px #0006);
	}
	.quiet .action {
		filter: none;
	}
	.shot-label {
		position: absolute;
		inset: auto 1.25rem 0.85rem;
		display: flex;
		justify-content: space-between;
		color: #ccc;
		font-size: 0.65rem;
		letter-spacing: 0.15em;
	}
	.caption {
		padding: 1.2rem 1.5rem;
		border-top: 1px solid #444;
		background: #191919;
	}
	h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 500;
		letter-spacing: 0.04em;
	}
	.caption h3 {
		display: flex;
		gap: 1rem;
		align-items: baseline;
	}
	.caption h3 span {
		color: #aaa;
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
	}
	.caption p {
		margin: 0.7rem 0 0;
		max-width: 64ch;
		font-size: 1rem;
		line-height: 1.9;
		overflow-wrap: anywhere;
	}
	footer {
		padding: 0.65rem 1.25rem 0.8rem;
		display: flex;
		align-items: center;
		gap: 0.8rem;
		color: #bbb;
		font-size: 0.72rem;
		flex-wrap: wrap;
		border-top: 1px solid #383838;
	}
	progress {
		flex: 1 1 100px;
		width: 120px;
		min-width: 40px;
		height: 4px;
		accent-color: #ddd;
		border: 0;
		background: #444;
	}
	progress::-webkit-progress-bar {
		background: #444;
	}
	progress::-webkit-progress-value {
		background: #ddd;
	}
	progress::-moz-progress-bar {
		background: #ddd;
	}
	.time {
		font-variant-numeric: tabular-nums;
	}
	.summary {
		max-height: 34rem;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 1.5rem;
		border-top: 1px solid #555;
		scrollbar-color: #999 #252525;
	}
	.summary > p {
		color: #bbb;
		font-size: 0.9rem;
	}
	.summary ol {
		padding-left: 1.4rem;
		margin-bottom: 0;
	}
	.summary li {
		padding: 0.25rem 0 1.2rem 0.4rem;
	}
	.summary li + li {
		border-top: 1px solid #444;
		padding-top: 1.2rem;
	}
	.summary h4 {
		margin: 0;
		font-size: 1rem;
		font-weight: 500;
	}
	.summary p {
		line-height: 1.85;
		margin: 0.65rem 0;
		overflow-wrap: anywhere;
	}
	.missing {
		padding: 1rem 1.25rem 2rem;
		line-height: 1.8;
		overflow-wrap: anywhere;
	}
	@media (max-width: 600px) {
		header {
			padding: 1rem 0.8rem 0.75rem;
			gap: 0.5rem;
		}
		.controls {
			padding: 0 0.8rem 0.8rem;
		}
		.controls button {
			flex: 1 1 auto;
		}
		.status {
			flex-basis: 100%;
			text-align: right;
		}
		.caption {
			padding: 1rem;
		}
		.caption p {
			font-size: 0.95rem;
		}
		.summary {
			padding: 1rem;
			max-height: 28rem;
		}
		.intensity {
			padding-inline: 0.8rem;
		}
		footer {
			padding-inline: 0.8rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.action {
			filter: none;
		}
	}
</style>
