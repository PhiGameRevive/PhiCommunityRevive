import fs from 'node:fs';

/** 仓库 .prettierrc 指定 endOfLine: crlf；这里把本次新增/修改的文本文件统一为 CRLF。 */
const files = process.argv.slice(2);
for (const file of files) {
	const text = fs.readFileSync(file, 'utf8');
	const normalized = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
	if (normalized !== text) {
		fs.writeFileSync(file, normalized, 'utf8');
		console.log(`CRLF: ${file}`);
	}
}
