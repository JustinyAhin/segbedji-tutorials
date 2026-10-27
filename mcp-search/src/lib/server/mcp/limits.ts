// A fixed-window limiter kept in memory. Good enough to show the shape
// locally. On Workers each isolate has its own memory, so production needs a
// shared, atomic counter (the real apps use an Upstash Redis Lua script).
const SEARCHES_PER_MINUTE = 10;
const SEARCHES_PER_DAY = 500;

const counters = new Map<string, number>();

const take = (key: string, max: number) => {
	const count = counters.get(key) ?? 0;
	if (count >= max) return false;
	counters.set(key, count + 1);
	return true;
};

const checkSearchLimit = async ({
	clientAddress,
	now = Date.now()
}: {
	clientAddress: string;
	now?: number;
}): Promise<'allowed' | 'rate_limited'> => {
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clientAddress));
	const id = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
	const minuteKey = `ip:${id}:${Math.floor(now / 60_000)}`;
	const dayKey = `day:${new Date(now).toISOString().slice(0, 10)}`;

	// Check both before incrementing either, so a rejected call doesn't burn
	// the global allowance.
	if ((counters.get(minuteKey) ?? 0) >= SEARCHES_PER_MINUTE) return 'rate_limited';
	if ((counters.get(dayKey) ?? 0) >= SEARCHES_PER_DAY) return 'rate_limited';
	take(minuteKey, SEARCHES_PER_MINUTE);
	take(dayKey, SEARCHES_PER_DAY);
	return 'allowed';
};

export { checkSearchLimit, SEARCHES_PER_MINUTE, SEARCHES_PER_DAY };
