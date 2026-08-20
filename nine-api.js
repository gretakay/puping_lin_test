/**
 * nine-grid cross-device sync API
 */

function setNineGridTarget(locName, itemName) {
	try {
		const cleanName = String(locName || '').trim();
		const cleanItemName = String(itemName || '').trim();
		if (!cleanName) {
			return { success: false, message: 'location is empty' };
		}

		const payload = {
			loc: cleanName,
			itemName: cleanItemName,
			ts: Date.now()
		};

		CacheService.getScriptCache().put('nine_grid_target_v1', JSON.stringify(payload), 21600);
		return { success: true, loc: payload.loc, itemName: payload.itemName, ts: payload.ts };
	} catch (e) {
		return { success: false, message: e.toString() };
	}
}

function getNineGridTarget() {
	try {
		const raw = CacheService.getScriptCache().get('nine_grid_target_v1');
		if (!raw) return { success: true, loc: '', itemName: '', ts: 0 };

		const data = JSON.parse(raw);
		return {
			success: true,
			loc: String((data && data.loc) || ''),
			itemName: String((data && data.itemName) || ''),
			ts: Number((data && data.ts) || 0)
		};
	} catch (e) {
		return { success: false, message: e.toString(), loc: '', itemName: '', ts: 0 };
	}
}
