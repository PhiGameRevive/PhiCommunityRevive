<script context="module" lang="ts">
	let panelCount = 0;
</script>

<script lang="ts">
	import { ARCHIVE_BASE, ARCHIVE_FILES, ARCHIVE_REVISION, DIAGNOSTIC_HELP, PUZZLES, diagnostic, puzzleCorrect } from './puzzles';
	import type { StorySave } from './types';

	export let id: string;
	export let save: StorySave;
	export let onsolve: (id: string) => void;
	/** 主控须持久保存排练书签和检查点成功后，才实际刷新；失败时保留当前页。 */
	export let onreload: () => void;

	const panelId = `yuye-puzzle-${++panelCount}`;
	let activeId = '';
	let answers: Record<string, string> = {};
	let submittedIds = new Set<string>();
	let stagedComparison = false;
	let reloadBusy = false;
	let reloadMessage = '';
	let attempted = false;
	let feedback = '';
	let diagnosticTarget: 'clock' | 'cast' | 'verify' | null = null;
	let previewSignature: string | null = null;
	let previewPassed = false;

	$: puzzle = Object.prototype.hasOwnProperty.call(PUZZLES, id) ? PUZZLES[id] : undefined;
	$: if (activeId !== id) resetPanel(id);
	$: solved = save.puzzles.includes(id) || submittedIds.has(id);
	$: comparisonReady = Boolean(save.reload?.returned) || stagedComparison;
	$: signature = JSON.stringify(puzzle?.questions.map((item) => answers[item.id] ?? '') ?? []);
	$: previewCurrent = previewSignature !== null && previewSignature === signature;
	$: diagnosticText = diagnosticTarget ? diagnostic(save, diagnosticTarget) : '';
	$: if (solved && puzzle) answers = Object.fromEntries(puzzle.questions.map((item) => [item.id, item.answer]));

	function resetPanel(nextId: string) {
		activeId = nextId;
		answers = {};
		stagedComparison = false;
		reloadBusy = false;
		reloadMessage = '';
		attempted = false;
		feedback = '';
		previewSignature = null;
		previewPassed = false;
		diagnosticTarget = nextId === 'P07' ? 'cast' : nextId === 'P08' ? 'verify' : null;
	}

	function choose(questionId: string, optionId: string) {
		if (solved) return;
		answers = { ...answers, [questionId]: optionId };
		feedback = '';
	}

	function checkAnswers(): boolean {
		attempted = true;
		if (!puzzle) return false;
		const missing = puzzle.questions.filter((item) => !answers[item.id]);
		if (missing.length) {
			feedback = `还有 ${missing.length} 项未选择：${missing.map((item) => item.prompt).join('；')}。`;
			return false;
		}
		if (!puzzleCorrect(id, answers)) {
			const wrong = puzzle.questions.filter((item) => answers[item.id] !== item.answer);
			feedback = `请重新核对：${wrong.map((item) => item.prompt).join('；')}。证据和三级完整提示始终可读，重选没有惩罚。`;
			return false;
		}
		return true;
	}

	async function requestReload() {
		if (solved || reloadBusy) return;
		const requestedId = id;
		reloadBusy = true;
		reloadMessage = '正在请求主界面保存排练书签与重返检查点；请以主界面的保存结果为准。';
		try {
			await onreload();
			if (id === requestedId) reloadMessage = '已请求保存并重开。仅在保存成功后由主界面刷新；若未重开，请查看保存提示、重试，或使用不刷新的等价路径。';
		} catch {
			if (id === requestedId) reloadMessage = '保存或重开未完成。请保留当前页面，可重试、使用主界面的故事存档导出，或直接选择“重开布景（不刷新）”。';
		} finally {
			if (id === requestedId) reloadBusy = false;
		}
	}

	function reopenStage() {
		if (solved) return;
		stagedComparison = true;
		reloadMessage = '已走“重开布景（不刷新）”等价路径：排练书签留在本次页面内，舞台切至定稿。没有声称已持久保存或真实刷新；现在可以完成同样的对照。';
		feedback = '';
	}

	function rehearse() {
		if (solved || !puzzle) return;
		previewPassed = checkAnswers();
		previewSignature = signature;
		if (previewPassed) feedback = '预演的三案例与席位安排均符合请求。请核对下方试演记录，再确认实施。预演本身没有修改存档。';
	}

	function submit() {
		if (solved || !puzzle || submittedIds.has(id)) return;
		if (id === 'P03' && !comparisonReady) {
			feedback = '请先保存并重返，或选择“重开布景（不刷新）”，取得两稿对照；只选中答案不能代替这个步骤。';
			return;
		}
		if (!checkAnswers()) return;
		if (id === 'P08' && (!previewCurrent || !previewPassed)) {
			feedback = '请先运行当前配置的预演，核对三案例和席位安排，再确认实施。修改选项后需要重新预演。';
			return;
		}
		// 先锁定再通知主控；存档写入及失败后的重试由主控统一处理。
		submittedIds = new Set([...submittedIds, id]);
		feedback = '推理通过，已通知主界面确认结果。';
		onsolve(id);
	}
</script>

{#if puzzle}
	<section class="puzzle-panel" aria-labelledby={`${panelId}-title`}>
		<header>
			<p class="eyebrow">证据板 / {puzzle.id}{solved ? ' / 已解 · 只读重看' : ''}</p>
			<h2 id={`${panelId}-title`}>{puzzle.title}</h2>
			<p>{puzzle.question}</p>
			<p class="reading-note">每项点击选择即可，不需要拖动。三层提示与完整答案一直开放。</p>
		</header>

		<div class="columns">
			<div class="evidence-column">
				<h3>证据并排</h3>
				<div class="evidence-grid">
					{#each puzzle.evidence as evidence, index}
						{#if id !== 'P03' || index !== 2 || comparisonReady || solved}
							<article class="evidence-card">
								<h4>{evidence.title}</h4>
								<p class="verbatim">{evidence.text}</p>
							</article>
						{:else}
							<article class="evidence-card">
								<h4>C · 等待重开后的舞台</h4>
								<p>先保存书签并重返，或使用下面明确标记的不刷新路径。完成对照后，定稿会出现在排练书签旁。</p>
							</article>
						{/if}
					{/each}
				</div>

				{#if id === 'P03'}
					<section class="tool-box" aria-labelledby={`${panelId}-reload-title`}>
						<h3 id={`${panelId}-reload-title`}>保存与对照</h3>
						{#if solved}
							<p>已完成两稿对照。这里只读重看，不会再次切稿或覆盖证据。</p>
						{:else if save.reload?.returned}
							<p>故事存档已确认重返：排练书签保留，当前舞台展示定稿。现在请完成右侧对照。</p>
						{:else}
							<p>原路径：主界面确认书签与检查点保存成功后，真正重新打开页面。保存失败时留在本页；可重试、从主界面导出故事存档，或采用内存等价路径。</p>
							<div class="actions">
								<button type="button" onclick={requestReload} disabled={reloadBusy}>{reloadBusy ? '正在请求保存…' : '保存书签并重新开页'}</button>
								<button type="button" onclick={reopenStage} disabled={stagedComparison}>重开布景（不刷新）</button>
							</div>
						{/if}
						<p class="status" role="status">{reloadMessage}</p>
						{#if stagedComparison && !save.reload?.returned && !solved}
							<p>当前为内存等价对照；退出或刷新前请在主界面保存完成结果。存储不可用也可在本页继续剧情。</p>
						{/if}
					</section>
				{/if}

				{#if id === 'P04' || id === 'P07' || id === 'P08'}
					<section class="tool-box" aria-labelledby={`${panelId}-diagnostic-title`}>
						<h3 id={`${panelId}-diagnostic-title`}>{id === 'P07' ? '故事存档阅读器 · 当前排演清单' : id === 'P08' ? '站内验收器 · 已确认存档' : '诊断端口 · 钟楼'}</h3>
						<p>这里与固定控制台 API 共用只读查询。提交答案和确认实施是另外的界面操作。</p>
						<button type="button" onclick={() => (diagnosticTarget = id === 'P04' ? 'clock' : id === 'P07' ? 'cast' : 'verify')}>
							{id === 'P04' ? '检查钟楼' : id === 'P07' ? '读取当前排演清单' : '读取三案例实施记录'}
						</button>
						{#if diagnosticTarget}
							<pre class="diagnostic-output" aria-live="polite">{diagnosticText}</pre>
						{/if}
						<details>
							<summary>电脑控制台的等价入口与帮助</summary>
							<p>浏览器菜单 → 更多工具（或开发者）→ 开发者工具 → Console／控制台。可手打对应的固定查询；手机或不熟悉控制台时直接使用上面的按钮即可。</p>
							<pre>{DIAGNOSTIC_HELP}</pre>
						</details>
					</section>
				{/if}

				{#if id === 'P06'}
					<section class="tool-box archive" aria-labelledby={`${panelId}-archive-title`}>
						<h3 id={`${panelId}-archive-title`}>源码阅览室 · 同版完整镜像</h3>
						<p>资料集：yuye/edition-01。以下都是虚构故事资料；全文由这四个本地源文件直接导入，没有改写为谜底摘要，代码仅作为文本展示。</p>
						{#if ARCHIVE_BASE && ARCHIVE_REVISION}
							<p class="publication">构建配置的冻结提交：<code>{ARCHIVE_REVISION}</code>。外链是否已发布由发行流程核验；若提交不可达或网络不可用，请继续阅读下方同版镜像。网络错误不是剧情线索。</p>
							<a href={ARCHIVE_BASE.replace('/blob/', '/tree/')} target="_blank" rel="noopener noreferrer">打开 GitHub 的完整线索目录（新窗口）</a>
						{:else}
							<p class="publication"><strong>尚未发布的源码线索：真实仓库冻结路线尚未验收。</strong>本构建没有配置有效的 40 位提交 SHA，不提供可能失效的版本外链，也不把 main 当成冻结提交。现在可使用下方完整同版站内镜像完成调查。</p>
							<p>发行目标仓库：<a href="https://github.com/PhiGameRevive/PhiCommunityRevive" target="_blank" rel="noopener noreferrer">PhiGameRevive/PhiCommunityRevive（仓库首页，新窗口）</a>。此链接不是已发布的线索文件。</p>
						{/if}
						<p class="verbatim">完整目录：story-evidence/yuye/edition-01/</p>
						<nav aria-label="同版源码文件目录">
							<ul>
								{#each ARCHIVE_FILES as file, index}
									<li><a href={`#${panelId}-archive-${index}`}>{file.path}</a></li>
								{/each}
							</ul>
						</nav>
						{#each ARCHIVE_FILES as file, index}
							<article class="archive-file" id={`${panelId}-archive-${index}`}>
								<h4>{file.path}</h4>
								<!-- svelte-ignore a11y_no_noninteractive_tabindex (可滚动的完整源码区域需要键盘聚焦与方向键滚动；region 保留其阅读语义) -->
								<div class="source-text" tabindex="0" role="region" aria-label={`${file.path} 完整源码，可滚动`}><pre>{file.text}</pre></div>
								<div class="file-links">
									<a href={`data:text/plain;charset=utf-8,${encodeURIComponent(file.text)}`} download={file.path.split('/').pop()}>下载此文件的镜像原文</a>
									{#if ARCHIVE_BASE}
										<a href={`${ARCHIVE_BASE}${file.path}`} target="_blank" rel="noopener noreferrer">同提交 GitHub 文件（新窗口）</a>
									{/if}
								</div>
								<p>文件内参照的同版资料：</p>
								<ul>
									{#each ARCHIVE_FILES as related, relatedIndex}
										{#if relatedIndex !== index}<li><a href={`#${panelId}-archive-${relatedIndex}`}>{related.path}</a></li>{/if}
									{/each}
								</ul>
							</article>
						{/each}
					</section>
				{/if}
			</div>

			<div class="answer-column">
				<form
					onsubmit={(event) => {
						event.preventDefault();
						submit();
					}}
					aria-label={`${puzzle.id} 证据推理`}
				>
					<h3>{id === 'P02' ? '逐份分卷与关系' : id === 'P00' || id === 'P05' ? '选择式排序与判断' : id === 'P06' ? '证据归位与因果关系' : id === 'P08' ? '三案例规则配置' : '逐项对照与判断'}</h3>
					{#each puzzle.questions as item, index}
						<fieldset disabled={solved} aria-describedby={attempted && answers[item.id] !== item.answer ? `${panelId}-${item.id}-feedback` : undefined}>
							<legend>{index + 1}. {item.prompt}</legend>
							{#each item.options as option}
								<label class:chosen={answers[item.id] === option.id}>
									<input type="radio" name={`${panelId}-${id}-${item.id}`} value={option.id} checked={answers[item.id] === option.id} onchange={() => choose(item.id, option.id)} />
									<span>{option.label}</span>
								</label>
							{/each}
							{#if attempted && answers[item.id] !== item.answer}
								<p class="answer-feedback" id={`${panelId}-${item.id}-feedback`}>{!answers[item.id] ? '这一项尚未选择。' : '这一项与证据不符，请重新对照对应版记、请求或记录。'}</p>
							{/if}
						</fieldset>
					{/each}

					{#if id === 'P08' && !solved}
						<section class="tool-box" aria-labelledby={`${panelId}-preview-title`}>
							<h4 id={`${panelId}-preview-title`}>本次配置的试演记录</h4>
							<p>预演仅对照当前配置，不写入存档。确认实施后，左侧只读验收器才显示已确认结果。</p>
							<button type="button" onclick={rehearse}>运行预演</button>
							{#if previewCurrent}
								<ul class="preview-results" aria-live="polite">
									{#each puzzle.questions as item}
										<li>
											<strong>{item.prompt}：{answers[item.id] === item.answer ? '符合请求' : '未通过'}</strong>
											<p>试演执行：{item.options.find((option) => option.id === answers[item.id])?.label ?? '未配置，未执行'}。</p>
										</li>
									{/each}
								</ul>
							{:else if previewSignature !== null}
								<p>配置已改变，上次预演已失效。请重新运行预演。</p>
							{/if}
						</section>
					{/if}

					{#if solved}
						<div class="solution" role="status">
							<h3>{save.puzzles.includes(id) ? '已完成 · 只读重看' : '推理通过 · 已通知主界面'}</h3>
							<p>{puzzle.explanation}</p>
						</div>
					{:else}
						{#if id === 'P03' && !comparisonReady}<p id={`${panelId}-submit-note`}>提交前需要完成保存重返，或“重开布景（不刷新）”的等价对照。</p>{/if}
						{#if id === 'P08'}<p id={`${panelId}-submit-note`}>当前配置预演通过后才可确认；修改任何选项后请重新预演。</p>{/if}
						<button
							class="submit"
							type="submit"
							disabled={(id === 'P03' && !comparisonReady) || (id === 'P08' && (!previewCurrent || !previewPassed))}
							aria-describedby={(id === 'P03' && !comparisonReady) || id === 'P08' ? `${panelId}-submit-note` : undefined}
						>
							{id === 'P08' ? '确认实施' : '提交推理'}
						</button>
					{/if}
					<p class="status" role="status">{feedback}</p>
				</form>
			</div>
		</div>

		<aside class="hints" aria-labelledby={`${panelId}-hint-title`}>
			<h3 id={`${panelId}-hint-title`}>随时可读的三级提示 · 第三级含完整答案</h3>
			<p>无需等待、无需先答错；使用提示不会扣除剧情或结局资格。</p>
			<ol>
				{#each puzzle.hints as hint, index}<li>
						<strong>{['第一级 · 证据位置', '第二级 · 推理关系', '第三级 · 完整操作'][index]}</strong>
						<p>{hint}</p>
					</li>{/each}
			</ol>
		</aside>
	</section>
{:else}
	<p role="status">没有找到对应谜题。请返回当前故事场景后重试。</p>
{/if}

<style>
	.puzzle-panel {
		--paper: #fff;
		--ink: #000;
		box-sizing: border-box;
		min-width: 0;
		max-width: 100%;
		padding: clamp(0.75rem, 2vw, 1.5rem);
		color: var(--ink);
		background: var(--paper);
		font-size: 1em;
		line-height: 1.7;
		overflow-wrap: anywhere;
		color-scheme: light;
	}
	.puzzle-panel :global(*) {
		box-sizing: border-box;
	}
	header {
		border-bottom: 2px solid var(--ink);
		margin-bottom: 1.5rem;
	}
	h2,
	h3,
	h4,
	p {
		margin: 0 0 0.8rem;
	}
	h2 {
		font-size: 1.4em;
	}
	h3 {
		font-size: 1.12em;
	}
	h4,
	legend {
		font-size: 1em;
		font-weight: 700;
	}
	.eyebrow {
		font-size: 0.9em;
		letter-spacing: 0.06em;
	}
	.reading-note {
		font-size: 0.95em;
	}
	.columns {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 1.5rem;
		align-items: start;
	}
	.evidence-column,
	.answer-column,
	form {
		min-width: 0;
	}
	.evidence-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
		gap: 0.75rem;
	}
	.evidence-card,
	.tool-box,
	.hints,
	.solution {
		min-width: 0;
		border: 1px solid var(--ink);
		padding: 1rem;
	}
	.evidence-card {
		border-top-width: 3px;
	}
	.tool-box,
	.hints,
	.solution {
		margin-top: 1rem;
	}
	.verbatim,
	pre {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		word-break: break-word;
	}
	pre {
		max-width: 100%;
		margin: 1rem 0;
		font-family: ui-monospace, monospace;
		font-size: 0.9em;
		line-height: 1.7;
	}
	.source-text {
		max-height: min(30rem, 65dvh);
		overflow: auto;
		padding: 0.75rem;
		border: 1px solid var(--ink);
	}
	.diagnostic-output {
		border-left: 3px solid var(--ink);
		padding-left: 0.75rem;
	}
	code {
		font-family: ui-monospace, monospace;
		word-break: break-all;
	}
	.archive-file {
		padding-top: 1rem;
		margin-top: 1rem;
		border-top: 1px solid var(--ink);
		scroll-margin-top: 1rem;
	}
	.publication {
		border: 2px solid var(--ink);
		padding: 0.75rem;
	}
	.file-links,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.file-links {
		margin-bottom: 1rem;
	}
	ul,
	ol {
		padding-left: 1.4rem;
	}
	li {
		margin-bottom: 0.6rem;
	}
	fieldset {
		min-width: 0;
		margin: 0 0 1rem;
		padding: 0.75rem;
		border: 1px solid var(--ink);
	}
	legend {
		padding: 0 0.3rem;
	}
	label {
		display: flex;
		align-items: flex-start;
		gap: 0.65rem;
		min-height: 44px;
		padding: 0.65rem;
		margin-top: 0.35rem;
		border: 1px solid var(--ink);
		cursor: pointer;
	}
	label.chosen {
		border-width: 3px;
		padding: calc(0.65rem - 2px);
	}
	input[type='radio'] {
		flex: 0 0 auto;
		width: 1.2rem;
		height: 1.2rem;
		margin: 0.22rem 0 0;
		accent-color: var(--ink);
	}
	fieldset:disabled label {
		cursor: default;
	}
	fieldset:disabled input {
		opacity: 1;
	}
	button {
		min-height: 44px;
		max-width: 100%;
		padding: 0.65rem 1rem;
		border: 1px solid var(--ink);
		border-radius: 0;
		background: var(--paper);
		color: var(--ink);
		font: inherit;
		line-height: 1.5;
		cursor: pointer;
		touch-action: manipulation;
	}
	button:hover:enabled,
	button.submit:enabled {
		background: var(--ink);
		color: var(--paper);
	}
	button:disabled {
		opacity: 1;
		cursor: default;
		border-style: dashed;
	}
	a {
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	nav a,
	.file-links a,
	.archive-file li a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}
	button:focus-visible,
	a:focus-visible,
	input:focus-visible,
	summary:focus-visible,
	.source-text:focus-visible {
		outline: 3px double var(--ink);
		outline-offset: 4px;
	}
	label:focus-within {
		outline: 2px solid var(--ink);
		outline-offset: 2px;
	}
	summary {
		min-height: 44px;
		padding-top: 0.65rem;
		cursor: pointer;
	}
	.status:empty {
		display: none;
	}
	.status,
	.answer-feedback {
		margin: 0.75rem 0 0;
	}
	.answer-feedback {
		font-weight: 700;
	}
	.preview-results {
		margin-top: 1rem;
	}
	.hints {
		border-top-width: 3px;
	}
	.hints li {
		padding: 0.35rem 0;
	}
	@media (max-width: 850px) {
		.columns {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 420px) {
		.puzzle-panel {
			padding: 0.65rem;
		}
		.evidence-card,
		.tool-box,
		.hints,
		.solution {
			padding: 0.7rem;
		}
		fieldset {
			padding: 0.5rem;
		}
		.actions {
			flex-direction: column;
		}
		.actions button {
			width: 100%;
		}
	}
</style>
