/**
 * When the camp can next do anything.
 *
 * Every door in a camp is priced, and until this existed the page showed the price and
 * left the arithmetic to the player: "needs 4 more scrap" beside a stores line reading
 * "+0.5/h" is a subtraction and a division the page already had both numbers for.
 *
 * That was survivable while the survivor was home, because the answer was always *send
 * them somewhere*. It stops being survivable the moment they are twelve hours away:
 * with the only actor gone, "needs 4 more scrap" is the whole game, and a player who
 * cannot turn it into an hour has no way to tell a wait from a dead end.
 *
 * Pure, and priced in the *net* rate — what the stores will actually do, after the
 * survivor has eaten and the weather has taken its cut. Gross production would promise
 * hours that never arrive, which is the failure mode `resources[].ratePerHour` was
 * already fixed for once. Fixing it here again would be fixing it in the wrong place.
 */

/**
 * Hours until `have` covers `costs` at `rates`, or null if it never does.
 *
 * Zero means now. Null means the rate is flat or falling on something the cost wants,
 * and no amount of waiting closes the gap — a distinction the page has to keep, because
 * "wait" and "go and get some" are different instructions to give a player.
 *
 * @param {Record<string, number>} costs what the thing wants
 * @param {Record<string, number>} have what the stores hold
 * @param {Record<string, number>} rates net change per hour, per resource
 */
export function hoursUntilAffordable(costs, have, rates) {
  let worst = 0;

  for (const [kind, amount] of Object.entries(costs ?? {})) {
    // Build costs carry their duration in the same object as their price, the same way
    // `shortfall` has to skip it. Better here than a caller stripping it every time.
    if (kind === 'hours') continue;

    const short = Number(amount) - Number(have[kind] ?? 0);
    if (short <= 0) continue;

    const rate = Number(rates[kind] ?? 0);
    if (rate <= 0) return null;

    worst = Math.max(worst, short / rate);
  }

  return worst;
}

/**
 * The camp's doors, soonest first, with the hour each one opens.
 *
 * **Sequential, and that is the whole point.** Pricing every door against the same
 * stores is the obvious implementation and it lies: a camp holding ten scrap, asked
 * about five things costing five to ten each, is told it can do all five — when what it
 * can actually do is one of them, and then wait. The first version of this shipped that
 * answer onto the dispatch table and every region read "5 things to do meanwhile",
 * including the ten-minute one, which made the column worthless in exactly the case it
 * was written for.
 *
 * So the purse is spent as the plan is walked. Cheapest-reachable first — a heuristic,
 * and a deliberately generous one: it is the ordering that opens the most doors in the
 * least time, so a window this says is empty is empty under any ordering.
 *
 * What it does *not* model is the crew. Builds and fittings share one queue, so two
 * builds an hour apart on this list are two builds an hour apart in fact only while
 * levels are cheap — which early on they are, at a minute or two each. Past the point
 * where a level takes hours, the crew becomes the real constraint and this reads
 * optimistically. It is the right place to fix that when the deep game needs it.
 *
 * Candidates come in already named and priced, because what counts as a door is a
 * question about content — a structure level, a recipe, a link — and this module has no
 * business knowing the answer. It knows only that a door has a price and the stores
 * have a rate.
 *
 * @param {{what: string, costs: Record<string, number>, blocked?: string|null}[]} candidates
 */
export function planFor(candidates, have, rates) {
  const remaining = candidates.filter((candidate) => !candidate.blocked);
  const purse = { ...have };
  const plan = [];
  let clock = 0;

  while (remaining.length > 0) {
    let soonest = null;
    let at = null;

    for (const candidate of remaining) {
      const wait = hoursUntilAffordable(candidate.costs, purse, rates);
      if (wait === null) continue;
      if (at === null || wait < at) {
        at = wait;
        soonest = candidate;
      }
    }

    // Everything left wants something the stores do not make. Not a long wait — a
    // different instruction, and one this list has no way to give.
    if (soonest === null) break;

    for (const kind of Object.keys(purse)) {
      purse[kind] += (Number(rates[kind]) || 0) * at;
    }
    for (const [kind, amount] of Object.entries(soonest.costs)) {
      if (kind === 'hours') continue;
      purse[kind] = (purse[kind] ?? 0) - Number(amount);
    }

    clock += at;
    plan.push({ what: soonest.what, inHours: clock });
    remaining.splice(remaining.indexOf(soonest), 1);
  }

  return plan;
}

/**
 * What the camp can do inside a window of `hours`, given a plan.
 *
 * The dispatch question in one number. Half-open at the top for the same reason a
 * moment's window is: a door that opens exactly as the survivor walks back through the
 * gate is not something you did while they were away.
 */
export function openWithin(plan, hours) {
  return plan.filter((entry) => entry.inHours < Number(hours));
}
