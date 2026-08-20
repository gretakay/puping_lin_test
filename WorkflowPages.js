function normalizeWorkflowKeyword(value) {
	return String(value || '').trim().toLowerCase();
}

function getTransferLocationList() {
	try {
		return getLocationList();
	} catch (e) {
		return [];
	}
}

function searchTransferCandidates(keyword, limit) {
	try {
		const kw = normalizeWorkflowKeyword(keyword);
		const maxCount = Math.max(1, Number(limit) || 20);
		const assets = getAvailableAssetsFull(true) || [];

		const items = assets
			.filter(item => {
				if (String(item.status || '').trim() !== '在庫') return false;
				if (!kw) return true;
				const searchText = [item.id, item.name, item.spec, item.color, item.location, item.keeper, item.unit, item.category]
					.map(v => String(v || '').trim())
					.join(' ')
					.toLowerCase();
				return searchText.indexOf(kw) > -1;
			})
			.slice(0, maxCount)
			.map(item => ({
				assetId: String(item.id || ''),
				itemName: String(item.name || ''),
				fromLocation: String(item.location || ''),
				availableQty: Number(item.count) || (Array.isArray(item.ids) ? item.ids.length : 1),
				status: String(item.status || '在庫'),
				keeper: String(item.keeper || ''),
				unit: String(item.unit || '件'),
				photoUrl: String(item.photoUrl || '')
			}));

		return { success: true, items: items };
	} catch (err) {
		return { success: false, message: err.toString(), items: [] };
	}
}

function getStocktakeLockState() {
	const props = PropertiesService.getScriptProperties();
	return {
		locked: String(props.getProperty('STOCKTAKE_LOCKED') || '').toLowerCase() === 'true',
		note: String(props.getProperty('STOCKTAKE_LOCK_NOTE') || ''),
		updatedAt: String(props.getProperty('STOCKTAKE_LOCK_UPDATED') || '')
	};
}

function setStocktakeLock(locked, note) {
	const props = PropertiesService.getScriptProperties();
	const isLocked = !!locked;
	props.setProperty('STOCKTAKE_LOCKED', isLocked ? 'true' : 'false');
	props.setProperty('STOCKTAKE_LOCK_NOTE', String(note || '').trim());
	props.setProperty('STOCKTAKE_LOCK_UPDATED', new Date().toISOString());
	return { success: true, locked: isLocked, note: String(note || '').trim() };
}

function getInventoryCorrectionData(includeSangha) {
	try {
		// 盤點應該盤「固定資產」，不是消耗品
		// 走 getAvailableAssetsFull 取固定資產表數據，而不是 getInventorySummary（消耗品）
		const assetsResult = getAvailableAssetsFull(true) || [];
		const items = Array.isArray(assetsResult) ? assetsResult
			.filter(asset => String(asset.status || '').trim() === '在庫')
			.map(asset => ({
				primaryId: String(asset.id || ''),
				name: String(asset.name || ''),
				location: String(asset.location || ''),
				bookQty: Number(asset.count) || (Array.isArray(asset.ids) ? asset.ids.length : 1),
				unit: String(asset.unit || '件'),
				category: String(asset.category || ''),
				color: String(asset.color || '無'),
				photoUrl: String(asset.photoUrl || ''),
				keeper: String(asset.keeper || ''),
				spec: String(asset.spec || ''),
				actualQty: '',
				diffQty: 0,
				adjustStatus: '待校正'
			})) : [];

		return {
			success: true,
			items: items,
			locked: getStocktakeLockState().locked,
			lockInfo: getStocktakeLockState()
		};
	} catch (err) {
		return { success: false, message: err.toString(), items: [], locked: false, lockInfo: getStocktakeLockState() };
	}
}

function checkStocktakeLocked() {
	const lockState = getStocktakeLockState();
	return !!lockState.locked;
}

function rejectIfStocktakeLocked(operation) {
	if (checkStocktakeLocked()) {
		return {
			success: false,
			message: `盤點進行中，暫時禁止「${operation}」操作。請等盤點結束後再進行。`,
			code: 'E_STOCKTAKE_LOCKED'
		};
	}
	return null;
}

function applyStocktakeCorrections(payload) {
	if (!checkStocktakeLocked()) {
		return {
			success: false,
			message: '請先開啟盤點鎖定，再執行盤點校正回寫。',
			code: 'E_STOCKTAKE_UNLOCKED'
		};
	}

	const reqRows = payload && Array.isArray(payload.rows) ? payload.rows : [];
	if (reqRows.length === 0) {
		return { success: false, message: '沒有可回寫的差異資料。', code: 'E_NO_ROWS' };
	}

	const operator = String((Session.getActiveUser() && Session.getActiveUser().getEmail()) || (Session.getEffectiveUser() && Session.getEffectiveUser().getEmail()) || 'unknown@unknown').trim();
	const commonReason = String(payload && payload.reason || '').trim();
	const lock = LockService.getScriptLock();
	const now = new Date();

	try {
		lock.waitLock(30000);

		let assetIndex = getAssetIndex() || {};
		const txRows = [];
		const failures = [];
		let updated = 0;

		reqRows.forEach((entry, idx) => {
			const primaryId = String(entry && entry.primaryId || '').trim();
			const actualQtyRaw = Number(entry && entry.actualQty);
			if (!primaryId) {
				failures.push({ index: idx, reason: '缺少資產編號' });
				return;
			}
			if (!Number.isFinite(actualQtyRaw) || actualQtyRaw < 0) {
				failures.push({ index: idx, assetId: primaryId, reason: '實盤數量格式錯誤' });
				return;
			}

			const hit = assetIndex[primaryId];
			if (!hit || !hit.sheet || !hit.row) {
				failures.push({ index: idx, assetId: primaryId, reason: '找不到資產索引，請重整後再試' });
				return;
			}

			const sheet = getAssetLocationSheet(hit.sheet);
			const rowNum = Number(hit.row);
			if (!Number.isFinite(rowNum) || rowNum <= 1) {
				failures.push({ index: idx, assetId: primaryId, reason: '索引列號無效' });
				return;
			}

			const rowValues = sheet.getRange(rowNum, 1, 1, 15).getValues()[0];
			const originalIds = String(rowValues[1] || '').split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
			const oldStatus = String(rowValues[6] || '').trim() || '在庫';
			const oldQty = Number(rowValues[13]) || 0;
			const currentQty = oldQty > 0 ? oldQty : originalIds.length;
			const nextQty = Math.floor(actualQtyRaw);
			const diff = nextQty - currentQty;
			if (diff === 0) return;

			if (originalIds.length > 0 && originalIds.indexOf(primaryId) === -1) {
				failures.push({ index: idx, assetId: primaryId, reason: '索引與資料不一致，請重整後再試' });
				return;
			}

			let nextIds = originalIds.slice();
			if (nextQty === 0) {
				nextIds = [];
			} else if (nextIds.length > nextQty) {
				nextIds = nextIds.slice(0, nextQty);
			}

			const rowReason = String(entry && entry.reason || '').trim();
			const finalReason = rowReason || commonReason || '盤點校正';
			const nextStatus = nextQty === 0 ? '已使用完' : '在庫';
			const stamp = Utilities.formatDate(now, 'GMT+8', 'yyyy-MM-dd HH:mm:ss');
			const oldNote = String(rowValues[9] || '').trim();
			const diffText = diff > 0 ? ('+' + diff) : String(diff);
			const markText = '[盤點校正 ' + stamp + ' ' + operator + '] 差異=' + diffText + '，原因=' + finalReason;
			const nextNote = oldNote ? (oldNote + ' | ' + markText) : markText;

			rowValues[1] = nextIds.join(', ');
			rowValues[6] = nextStatus;
			rowValues[9] = nextNote;
			rowValues[13] = nextQty;
			sheet.getRange(rowNum, 1, 1, 15).setValues([rowValues]);

			const removedIds = originalIds.filter(id => nextIds.indexOf(id) === -1);
			removeIndexEntries(assetIndex, removedIds);
			if (nextIds.length > 0) {
				upsertIndexEntries(assetIndex, nextIds, hit.sheet, rowNum);
			}

			txRows.push([
				now,
				'盤點校正',
				String(rowValues[2] || entry.name || ''),
				primaryId,
				diff,
				operator,
				oldStatus,
				operator,
				nextStatus
			]);
			updated++;
		});

		if (txRows.length > 0) {
			const txSheet = getSheet(TRANS_ASSETS_NAME);
			txSheet.getRange(txSheet.getLastRow() + 1, 1, txRows.length, txRows[0].length).setValues(txRows);
			saveAssetIndex(assetIndex);
			invalidateCachesByEvent('assetMutation');
		}

		return {
			success: txRows.length > 0,
			message: txRows.length > 0 ? ('盤點校正已回寫 ' + txRows.length + ' 筆') : '沒有可回寫的差異',
			updatedCount: updated,
			failedCount: failures.length,
			failures: failures
		};
	} catch (err) {
		return { success: false, message: err.toString(), updatedCount: 0, failedCount: 0, failures: [] };
	} finally {
		lock.releaseLock();
	}
}