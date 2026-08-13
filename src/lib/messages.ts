/**
 * 本地化消息占位实现（原 PhiZone player 使用 paraglide/paraglide 生成，
 * 此处直接硬编码中文文案以移除 i18n 依赖）。
 */

export const m = {
	app_title: () => 'PhiCommunity',
	loading: (p: { name: string }) => `正在加载 ${p.name}`,
	downloading: (p: { name: string }) => `正在下载 ${p.name}`,
	processing_audio: () => '正在处理音频',
	error_no_data_provided: () => '未提供谱面数据！',
	error_failed_to_load_chart: () => '谱面加载失败！',
	error_failed_to_load: (p: { name: string }) => `${p.name} 加载失败！`,
	error_shader_not_found: (p: { name: string }) => `找不到着色器：${p.name}`,
	error_shader_unavailable: () => '当前渲染器不支持着色器！',
	error_shader_texture_missing: (p: { name: string; shader: string }) =>
		`着色器 ${p.shader} 引用的贴图不存在：${p.name}`,
	error_video_unsupported: (p: { name: string }) => `不支持的视频格式：${p.name}`,
	error_failed_to_load_video: (p: { name: string }) => `视频加载失败：${p.name}`,
	warn_event_time_invalid: (p: { start: number[]; end: number[]; source: string }) =>
		`${p.source} 中的事件时间无效：${p.start.join('-')} → ${p.end.join('-')}`,
	drawing_background: () => '正在绘制背景',
	initializing_chart: () => '正在初始化谱面',
	preprocessing_chart: () => '正在预处理谱面',
	initializing_handlers: () => '正在初始化处理器',
	setting_up_ui: () => '正在设置界面',
	initializing_hit_effects: () => '正在初始化打击特效',
	initializing_shaders: () => '正在初始化着色器',
	initializing_videos: () => '正在初始化视频',
	rendering: () => '渲染中',
	rendering_saved: (p: { path: string }) => `渲染结果已保存：${p.path}`,
	open_file: () => '打开文件',
	open_folder: () => '打开文件夹',
	cancel: () => '取消',
	start: () => '开始',
	paused: () => '已暂停',
	restart: () => '重新开始',
	resume: () => '继续',
};