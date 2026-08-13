import './style.redirect.css';
window.addEventListener('DOMContentLoaded', () => {
	fetch('https://api.github.com/repos/MoeFurina/PhiCommunity/commits')
		.then((res) => {
			if (!res.ok) {
				throw new Error(`HTTP error! status: ${res.status}`);
			}
			return res.json();
		})
		.then((data) => {
			const changeLogFrame = document.querySelector(
				'div#changelogContainer'
			);
			if (!Array.isArray(data)) {
				console.error('获取提交历史失败：返回数据不是数组格式');
				return;
			}
			data.forEach(({ commit, html_url, sha }) => {
				const item = document.createElement('a');
				item.classList.add('item');
				item.href = html_url;
				item.setAttribute('data-sha', sha.slice(0, 7));
				item.innerText = commit.message;
				changeLogFrame.appendChild(item);
			});
		})
		.catch((error) => {
			console.error('获取提交历史时出错:', error);
			const changeLogFrame = document.querySelector('div#changelogContainer');
			if (changeLogFrame) {
				changeLogFrame.innerHTML = '<p class="error">获取提交历史失败，请稍后重试</p>';
			}
		});
	const addBtn = document.querySelector('#installPWA');
	addBtn.style.display = 'none';
	window.addEventListener('beforeinstallprompt', (e) => {
		e.preventDefault();
		addBtn.style.display = 'unset';
		addBtn.addEventListener('click', ({ prompt, userChoice }) => {
			prompt();
			userChoice.then(({ outcome }) => {
				if (outcome === 'accepted') {
					console.log('准备添加到主屏幕');
				} else {
					console.log('用户拒绝了添加到主屏幕');
				}
			});
		});
	});

	document.querySelector('button#go').addEventListener('click', () => {
		location.href = './tapToStart/index.html';
	});
	document
		.querySelector('button#gotoCFPages')
		.addEventListener('click', () => {
			location.href = 'https://cf.phicm.focalors.ltd';
		});
	document
		.querySelector('button#gotoEO')
		.addEventListener('click', () => {
			location.href = 'https://eo.phicm.focalors.ltd';
		});
	document
		.querySelector('button#gotoVercel')
		.addEventListener('click', () => {
			location.href = 'https://vercel.phicm.focalors.ltd';
		});
	document
		.querySelector('button#gotoGHPages')
		.addEventListener('click', () => {
			location.href = 'https://phicm.focalors.ltd';
		});
	if (location.href.match('cf')) {
		document.querySelector('button#gotoCFPages').style.display = 'none';
	} else if (location.href.match('vercel')) {
		document.querySelector('button#gotoVercel').style.display = 'none';
	} else if (location.href.match('eo')) {
		document.querySelector('button#gotoEO').style.display = 'none';
	} else {
		document.querySelector('button#gotoGHPages').style.display = 'none';
	}
	document.querySelector('button#ghRepo').addEventListener('click', () => {
		window.open('https://github.com/phigamerevive/PhiCommunity');
	});
	document.querySelector('button#deviceReq').addEventListener('click', () => {
		document
			.querySelector('div#devRequirementPopupOverlay')
			.classList.add('show');
	});
	document
		.querySelector('div#devRequirementPopupOverlay')
		.addEventListener('click', (e) => {
			if (e.target !== document.querySelector('#devReq')) {
				document
					.querySelector('div#devRequirementPopupOverlay')
					.classList.remove('show');
			}
		});
	document.querySelector('button#changeLog').addEventListener('click', () => {
		document
			.querySelector('div#changeLogContainerPopupOverlay')
			.classList.add('show');
	});
	document
		.querySelector('div#changeLogContainerPopupOverlay')
		.addEventListener('click', (e) => {
			if (e.target !== document.querySelector('#changelogContainer')) {
				document
					.querySelector('div#changeLogContainerPopupOverlay')
					.classList.remove('show');
			}
		});
	document.querySelector('button#ContactUs').addEventListener('click', () => {
		document
			.querySelector('div#ContactUsPopupOverlay')
			.classList.add('show');
	});
	document
		.querySelector('div#ContactUsPopupOverlay')
		.addEventListener('click', (e) => {
			if (e.target !== document.querySelector('#ContactUs')) {
				document
					.querySelector('div#ContactUsPopupOverlay')
					.classList.remove('show');
			}
		});
});

/* if ('serviceWorker' in navigator) {
	navigator.serviceWorker.register('sw.js').then(function () {
		console.log('Service Worker Registered');
	});
} */
if ('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker
			.register('/service-worker.js')
			.then((registration) => {
				console.log('SW registered: ', registration);
			})
			.catch((registrationError) => {
				console.log('SW registration failed: ', registrationError);
			});
	});
}
