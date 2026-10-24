using RepBrasil.Application.LiveElection.Tse;

namespace RepBrasil.Application.LiveElection;

/// <summary>
/// Projeta o estado interno no contrato público. Puro (sem E/S) e determinístico: dado o mesmo estado e o mesmo
/// relógio, a mesma resposta. Agregações territoriais usam sempre somas absolutas (nunca média de percentuais).
/// </summary>
public static class LiveProjector
{
    public const string Coverage_Complete = "complete";
    public const string Coverage_Partial = "partial";
    public const string Coverage_Stale = "stale";

    private static readonly int[] VelocityWindows = [1, 5, 15];

    /// <summary>Caminho público da foto (relativo à API). O frontend o resolve contra a base da API.</summary>
    public static string PhotoPath(LiveElectionContext context, string sqcand) =>
        $"/api/v1/elections/{context.Year}/president/second-round/photos/{sqcand}";

    // ---------------------------------------------------------------- meta

    public static LiveMetaDto Meta(LiveElectionState state, DateTimeOffset now, string? coverage = null)
    {
        var national = state.National;
        return new LiveMetaDto(
            "TSE",
            state.Context.Mode,
            state.Phase.ToString(),
            state.Context.Election.ElectionCode,
            state.NationalVersion,
            national?.GeneratedAt,
            national?.TotalizedAt,
            national?.IngestedAt,
            now,
            national is null ? null : Math.Max(0, (now - national.IngestedAt).TotalSeconds),
            national?.GeneratedAt is { } generated ? Math.Max(0, (national.IngestedAt - generated).TotalSeconds) : null,
            coverage ?? (state.Source.Stale ? Coverage_Stale : Coverage_Complete),
            state.Phase == LivePhase.FINAL,
            national?.MathFlag == "e" || state.Phase == LivePhase.MATHEMATICALLY_DEFINED);
    }

    // ---------------------------------------------------------------- candidatos

    public static IReadOnlyList<CandidateProfile> Profiles(LiveElectionState state) =>
        state.National?.Profiles.OrderBy(p => p.Position).ToList() ?? [];

    public static IReadOnlyList<string> CandidateOrder(LiveElectionState state) => [.. Profiles(state).Select(p => p.Key)];

    public static IReadOnlyList<LiveCandidateDto> Candidates(LiveElectionState state)
    {
        var profiles = Profiles(state);
        return
        [
            .. profiles.Select((p, i) => new LiveCandidateDto(
                p.Key,
                i == 0 ? "a" : "b",
                p.Number,
                p.Name ?? p.BallotName,
                p.BallotName,
                p.PartyAcronym,
                p.PartyName,
                Coalition(p.Group),
                p.Vice is { BallotName: not null } vice ? new RunningMateDto(vice.Name ?? vice.BallotName, vice.BallotName, vice.Party) : null,
                state.Context.Mode == LiveModes.Replay ? null : PhotoPath(state.Context, p.Key),
                p.Destination,
                p.Situation,
                p.Elected == true,
                p.Position)),
        ];
    }

    private static CoalitionDto? Coalition(Ea20Group group)
    {
        if (group.Name is null) return null;
        var kind = group.Kind switch
        {
            "c" => "coligacao",
            "f" => "federacao",
            _ => "partido-isolado",
        };
        return new CoalitionDto(group.Name, kind, group.Composition);
    }

    public static string NameOf(LiveElectionState state, string key) =>
        state.National?.Profiles.FirstOrDefault(p => p.Key == key)?.BallotName ?? key;

    // ---------------------------------------------------------------- abrangências

    public static TerritoryResultDto Territory(
        TerritorySnapshot? s,
        string scope,
        string code,
        string? uf,
        string name,
        bool capital,
        IReadOnlyList<string> order,
        string coverage)
    {
        // Nenhuma seção totalizada na abrangência: os zeros publicados pelo TSE não são resultado — saem como null ("—").
        var started = s is not null && s.Sections.Totalized is > 0;
        var tallies = order.Select(key => s?.Candidates.FirstOrDefault(c => c.Key == key) ?? new CandidateTally(key, null, null)).ToList();
        if (s is not null)
            tallies.AddRange(s.Candidates.Where(c => !order.Contains(c.Key)));
        if (!started) tallies = [.. tallies.Select(t => t with { Votes = null, Percent = null })];
        return new TerritoryResultDto(
            scope,
            code,
            uf?.ToUpperInvariant(),
            name,
            Regions.Of(uf),
            capital,
            [.. tallies.Select(t => new CandidateVotesDto(t.Key, t.Votes, t.Percent))],
            started ? s!.LeaderKey : null,
            started ? s!.LeadVotes : null,
            started ? s!.LeadPp : null,
            Sections(s?.Sections ?? SectionCounts.Empty),
            Electorate(s?.Electorate ?? ElectorateCounts.Empty),
            started ? Votes(s!.Votes) : Votes(VoteCounts.Empty),
            LivePhases.ProgressName(s?.Progress),
            s?.TotalizedAt,
            s?.GeneratedAt,
            s?.IngestedAt,
            s is null ? Coverage_Partial : coverage,
            s is not null);
    }

    /// <summary>Percentual oficial quando o denominador existe; denominador zero → null (0 de 0 não é 0%).</summary>
    private static decimal? Pct(decimal? official, long? part, long? whole) =>
        whole is null or <= 0 ? null : official ?? ElectionMath.Share(part, whole);

    public static SectionTotalsDto Sections(SectionCounts s) => new(
        s.Total,
        s.Totalized,
        s.NotTotalized,
        s.Installed,
        s.NotInstalled,
        s.Counted,
        s.NotCounted,
        Pct(s.TotalizedPct, s.Totalized, s.Total),
        Pct(s.InstalledPct, s.Installed, s.Totalized),
        Pct(s.CountedPct, s.Counted, s.Installed));

    public static ElectorateTotalsDto Electorate(ElectorateCounts e) => new(
        e.Total,
        e.InTotalized,
        e.InNotTotalized,
        e.InInstalled,
        e.InNotInstalled,
        e.InCounted,
        e.InNotCounted,
        e.Turnout,
        e.Abstention,
        Pct(e.InTotalizedPct, e.InTotalized, e.Total),
        Pct(e.InCountedPct, e.InCounted, e.InInstalled),
        ElectionMath.Share(e.InCounted, e.Total),
        Pct(e.TurnoutPct, e.Turnout, e.InInstalled),
        Pct(e.AbstentionPct, e.Abstention, e.InInstalled));

    public static VoteTotalsDto Votes(VoteCounts v) => new(
        v.Total,
        v.ToCandidates,
        v.Valid,
        v.Nominal,
        v.Annulled,
        v.AnnulledSubJudice,
        v.Blank,
        v.NullTotal,
        v.Null,
        v.TechnicalNull,
        v.AnnulledSections,
        v.NoCandidate,
        ElectionMath.Share(v.Valid, v.Total),
        Pct(v.BlankPct, v.Blank, v.Total),
        Pct(v.NullTotalPct, v.NullTotal, v.Total),
        Pct(v.AnnulledPct, v.Annulled, v.ToCandidates));

    /// <summary>UF defasada: o EA14 já mostra totalização mais nova que o arquivo da UF recebido.</summary>
    public static string StateCoverage(LiveElectionState state, string uf)
    {
        if (!state.States.TryGetValue(uf, out var snapshot)) return Coverage_Partial;
        var entry = state.NationalAccompaniment?.Entries.FirstOrDefault(e => e.ScopeType == "uf" && e.Code == uf);
        if (entry?.TotalizedAt is { } known && (snapshot.TotalizedAt is null || known > snapshot.TotalizedAt)) return Coverage_Stale;
        return Coverage_Complete;
    }

    /// <summary>Idade máxima de um resultado municipal enquanto a UF ainda está em totalização.</summary>
    public static readonly TimeSpan MunicipalFreshness = TimeSpan.FromMinutes(10);

    /// <summary>
    /// Defasado quando o EA15 indica totalização mais nova OU quando a UF ainda apura (EA14) e o arquivo municipal tem
    /// mais de 10 min — o EA15 pode estar desatualizado (no pré-eleição de 2026 havia EA15 gerado dias antes do EA14).
    /// </summary>
    public static string MunicipalityCoverage(LiveElectionState state, string uf, string code)
    {
        if (!state.Municipalities.TryGetValue(code, out var snapshot)) return Coverage_Partial;
        var entry = AccompanimentOf(state, uf, code);
        if (entry?.TotalizedAt is { } known && (snapshot.TotalizedAt is null || known > snapshot.TotalizedAt)) return Coverage_Stale;
        var ufInProgress = state.NationalAccompaniment?.Entries.FirstOrDefault(e => e.ScopeType == "uf" && e.Code == uf)?.Progress == "p";
        var reference = state.National?.IngestedAt;
        if (ufInProgress && reference is { } r && r - snapshot.IngestedAt > MunicipalFreshness) return Coverage_Stale;
        return Coverage_Complete;
    }

    /// <summary>Eleitorado do município: o do EA20 recebido; sem ele, o do EA15.</summary>
    public static long? MunicipalElectorate(LiveElectionState state, string uf, string code) =>
        state.Municipalities.TryGetValue(code, out var s) && s.Electorate.Total is { } te ? te : AccompanimentOf(state, uf, code)?.Electorate.Total;

    public static AccompanimentEntry? AccompanimentOf(LiveElectionState state, string uf, string code) =>
        state.StateAccompaniment.TryGetValue(uf, out var file) ? file.Entries.FirstOrDefault(e => e.ScopeType == "mun" && e.Code == code) : null;

    public static TerritoryResultDto State(LiveElectionState state, string uf)
    {
        state.States.TryGetValue(uf, out var snapshot);
        return Territory(snapshot, "uf", uf.ToUpperInvariant(), uf, Regions.NameOfUf(uf), false, CandidateOrder(state), StateCoverage(state, uf));
    }

    public static TerritoryResultDto Municipality(LiveElectionState state, string code)
    {
        if (!state.Context.TryMunicipality(code, out var uf, out var municipality))
            return Territory(null, "mu", code, null, code, false, CandidateOrder(state), Coverage_Partial);
        state.Municipalities.TryGetValue(code, out var snapshot);
        return Territory(snapshot, "mu", code, uf, municipality.Name, municipality.Capital, CandidateOrder(state), MunicipalityCoverage(state, uf, code));
    }

    // ---------------------------------------------------------------- resumo nacional

    public static OfficialStatusDto Official(TerritorySnapshot? s) => new(
        LivePhases.ProgressName(s?.Progress),
        s?.FinalTotalization == true,
        s?.MathFlag,
        s?.VotesReleased != false && s is not null,
        s?.NonFinalReason,
        s?.NoElectedAttribution,
        s?.NoElectedReasons ?? []);

    public static IrreversibilityResult Independent(LiveElectionState state) =>
        state.National is { } n ? ElectionMath.Evaluate(n.Candidates, n.Electorate) : IrreversibilityResult.Unavailable("Sem snapshot nacional.");

    /// <summary>
    /// Versão pública: enquanto o TSE não sinalizar md=e, o REPBrasil não antecipa a definição — se o limite
    /// conservador já foi atingido, a distância sai null (os números de vantagem e teto continuam visíveis).
    /// </summary>
    public static MathStatusDto MathPublic(LiveElectionState state)
    {
        var m = Independent(state);
        var officialDefined = state.National?.MathFlag == "e";
        var distance = m.DistanceToIrreversibility;
        if (m.IsMathematicallyIrreversible && !officialDefined) distance = null;
        return new MathStatusDto(
            new OfficialMathDto(state.National?.MathFlag, officialDefined || state.Math.TseSignalDetectedAt is not null, state.Math.TseDefinedAt, state.Math.TseSignalDetectedAt),
            new IndependentMathDto(
                m.Available,
                m.Reason,
                m.LeaderKey,
                m.RunnerUpKey,
                m.LeaderVotes,
                m.RunnerUpVotes,
                m.LeadVotes,
                m.RemainingElectorateUpperBound,
                m.MaxPossibleTrailingCandidate,
                m.VotesNeededForTrailingCandidate,
                distance,
                m.InvariantsOk));
    }

    public static SourceStatusDto Source(LiveElectionState state, DateTimeOffset now)
    {
        var src = state.Source;
        string? message = null;
        if (src.BlockedUntil is not null || src.Failing)
            message = "Fonte oficial temporariamente inacessível. O último dado oficial recebido continua exibido.";
        else if (src.Stale && src.LastChangeAt is { } changed)
            message = $"Dados oficiais sem atualização há {Math.Max(1, (int)(now - changed).TotalMinutes)} min. Aguardando nova atualização da fonte.";
        var national = state.National;
        return new SourceStatusDto(
            !src.Failing,
            src.Stale,
            src.StaleSince,
            src.LastFileGeneratedAt ?? national?.GeneratedAt,
            national?.IngestedAt,
            src.LastCheckedAt,
            national?.GeneratedAt is { } g ? Math.Max(0, (national.IngestedAt - g).TotalSeconds) : null,
            message);
    }

    public static VelocityDto Velocity(LiveElectionState state)
    {
        var points = state.Timeline;
        if (points.Count < 2 || state.National is null) return new VelocityDto([.. VelocityWindows.Select(w => new VelocityWindowDto(w, null, null, null, points.Count))], null);
        static DateTimeOffset Time(TimelinePoint p) => p.At ?? p.IngestedAt;
        var latest = points[^1];
        var windows = new List<VelocityWindowDto>();
        foreach (var minutes in VelocityWindows)
        {
            var from = Time(latest) - TimeSpan.FromMinutes(minutes);
            // Do fim para o começo até sair da janela: o custo é o da janela, não o de horas de histórico.
            var samples = 0;
            TimelinePoint? firstInWindow = null;
            TimelinePoint? before = null;
            for (var i = points.Count - 1; i >= 0; i--)
            {
                var p = points[i];
                if (Time(p) < from)
                {
                    before = p;
                    break;
                }
                samples++;
                firstInWindow = p;
            }
            // Ponto de partida: o último antes da janela (se houver), para medir a janela inteira.
            var anchor = before ?? firstInWindow;
            var covered = anchor is not null && Time(latest) - Time(anchor) >= TimeSpan.FromMinutes(minutes) / 2;
            if (anchor is null || !covered || ReferenceEquals(anchor, latest) || Time(latest) <= Time(anchor))
            {
                windows.Add(new VelocityWindowDto(minutes, null, null, null, samples));
                continue;
            }
            var elapsed = Time(latest) - Time(anchor);
            windows.Add(new VelocityWindowDto(
                minutes,
                Round2(ElectionMath.PerMinute(anchor.TotalVotes, latest.TotalVotes, elapsed)),
                Round2(ElectionMath.PerMinute(anchor.SectionsTotalized, latest.SectionsTotalized, elapsed)),
                Round2(ElectionMath.PerMinute(anchor.ElectorateInTotalized, latest.ElectorateInTotalized, elapsed)),
                samples));
        }

        EtaDto? eta = null;
        var w15 = windows.First(w => w.Minutes == 15);
        var w5 = windows.First(w => w.Minutes == 5);
        var remaining = state.National.Sections.NotTotalized;
        if (remaining > 0 && w15.SectionsPerMinute > 0 && w5.SectionsPerMinute > 0 && w15.Samples >= 4)
        {
            var ratio = w5.SectionsPerMinute.Value / w15.SectionsPerMinute.Value;
            if (ratio is >= 0.5m and <= 2m)
            {
                var minutes = (double)(remaining.Value / w15.SectionsPerMinute.Value);
                if (minutes is > 0 and < 12 * 60) eta = new EtaDto(Time(latest).AddMinutes(minutes), 15);
            }
        }
        return new VelocityDto(windows, eta);
    }

    private static decimal? Round2(decimal? value) => value is null ? null : Math.Round(value.Value, 2);

    public static IReadOnlyList<LiveTimelineEventDto> PublicEvents(LiveElectionState state) =>
        [.. state.Events.Where(e => e.IsPublic).Select(EventDto)];

    public static LiveTimelineEventDto EventDto(LiveEvent e) => new(e.Id, e.Type, e.At, e.DetectedAt, e.Title, e.Detail, e.SectionsPct);

    public static DefinedSnapshotDto? Defined(LiveElectionState state) =>
        state.Math.Defined is { } d ? new DefinedSnapshotDto(d.LeaderKey, d.Votes, d.Pct, d.LeadVotes, d.SectionsPct, d.DefinedAt, d.DetectedAt) : null;

    public static ElectionInfoDto Election(LiveElectionContext c) => new(
        c.Year,
        c.Election.Round,
        c.Election.ElectionCode,
        c.Election.FirstRoundElectionCode,
        c.Election.PleitoCode,
        c.Election.OfficeCode,
        c.Election.OfficeName,
        c.Election.Date?.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
        c.Mode,
        c.Environment.Environment,
        c.Election.Cycle);

    public static TerritoryResultDto National(LiveElectionState state) =>
        Territory(state.National, "br", "br", null, "Brasil", false, CandidateOrder(state), state.Source.Stale ? Coverage_Stale : Coverage_Complete);

    public static LiveSummaryDto Summary(LiveElectionState state) => new(
        Election(state.Context),
        state.Phase.ToString(),
        Official(state.National),
        Candidates(state),
        National(state),
        MathPublic(state),
        Source(state, state.Source.LastCheckedAt ?? state.National?.IngestedAt ?? DateTimeOffset.UtcNow),
        Velocity(state),
        PublicEvents(state),
        Defined(state));

    public static NationalUpdateDto NationalUpdate(LiveElectionState state) => new(
        state.Phase.ToString(),
        Official(state.National),
        National(state),
        MathPublic(state),
        Source(state, state.Source.LastCheckedAt ?? state.National?.IngestedAt ?? DateTimeOffset.UtcNow),
        Velocity(state),
        Defined(state));

    // ---------------------------------------------------------------- UFs, regiões, restantes

    public static IReadOnlyList<string> UfCodes(LiveElectionState state)
    {
        var known = state.Context.Ufs.Select(u => u.Uf).Where(uf => uf != "zz").ToList();
        return known.Count > 0 ? known.OrderBy(u => u, StringComparer.Ordinal).ToList() : [.. Regions.ByUf.Keys.OrderBy(u => u, StringComparer.Ordinal)];
    }

    public static LiveStatesPayloadDto States(LiveElectionState state)
    {
        var order = CandidateOrder(state);
        var ufs = UfCodes(state);
        var states = ufs.Select(uf => State(state, uf)).ToList();
        var exterior = state.States.ContainsKey("zz") || state.Context.Ufs.Any(u => u.Uf == "zz") ? State(state, "zz") : null;
        var regions = Regions.All.Select(r => Region(state, r.Code, r.Name, order)).ToList();
        return new LiveStatesPayloadDto(states, exterior, regions, Remaining(state), TerritorialSummary(state, ufs));
    }

    public static TerritoryResultDto Region(LiveElectionState state, string code, string name, IReadOnlyList<string> order)
    {
        var members = Regions.ByUf.Where(kv => kv.Value == code).Select(kv => kv.Key).ToList();
        var snapshots = members.Select(uf => state.States.GetValueOrDefault(uf)).ToList();
        var present = snapshots.Where(s => s is not null).Cast<TerritorySnapshot>().ToList();
        var coverage = present.Count < members.Count
            ? Coverage_Partial
            : members.Any(uf => StateCoverage(state, uf) == Coverage_Stale) ? Coverage_Stale : Coverage_Complete;
        return Aggregate("region", code, null, name, present, order, coverage) with { Region = code };
    }

    /// <summary>Soma absoluta de abrangências (numeradores e denominadores), recalculando os percentuais.</summary>
    public static TerritoryResultDto Aggregate(
        string scope,
        string code,
        string? uf,
        string name,
        IReadOnlyList<TerritorySnapshot> parts,
        IReadOnlyList<string> order,
        string coverage)
    {
        if (parts.Count == 0) return Territory(null, scope, code, uf, name, false, order, Coverage_Partial);
        static long? Sum(IEnumerable<long?> values)
        {
            long total = 0;
            foreach (var v in values)
            {
                if (v is null) return null;
                total = checked(total + v.Value);
            }
            return total;
        }

        var s = new SectionCounts(
            Sum(parts.Select(p => p.Sections.Total)),
            Sum(parts.Select(p => p.Sections.Totalized)),
            Sum(parts.Select(p => p.Sections.NotTotalized)),
            Sum(parts.Select(p => p.Sections.Installed)),
            Sum(parts.Select(p => p.Sections.NotInstalled)),
            Sum(parts.Select(p => p.Sections.Counted)),
            Sum(parts.Select(p => p.Sections.NotCounted)),
            null,
            null,
            null);
        var e = new ElectorateCounts(
            Sum(parts.Select(p => p.Electorate.Total)),
            Sum(parts.Select(p => p.Electorate.InTotalized)),
            Sum(parts.Select(p => p.Electorate.InNotTotalized)),
            Sum(parts.Select(p => p.Electorate.InInstalled)),
            Sum(parts.Select(p => p.Electorate.InNotInstalled)),
            Sum(parts.Select(p => p.Electorate.InCounted)),
            Sum(parts.Select(p => p.Electorate.InNotCounted)),
            Sum(parts.Select(p => p.Electorate.Turnout)),
            Sum(parts.Select(p => p.Electorate.Abstention)),
            null,
            null,
            null,
            null);
        var v = new VoteCounts(
            Sum(parts.Select(p => p.Votes.Total)),
            Sum(parts.Select(p => p.Votes.ToCandidates)),
            Sum(parts.Select(p => p.Votes.Valid)),
            Sum(parts.Select(p => p.Votes.Nominal)),
            Sum(parts.Select(p => p.Votes.Legend)),
            Sum(parts.Select(p => p.Votes.Annulled)),
            Sum(parts.Select(p => p.Votes.AnnulledSubJudice)),
            Sum(parts.Select(p => p.Votes.NoCandidate)),
            Sum(parts.Select(p => p.Votes.Blank)),
            Sum(parts.Select(p => p.Votes.NullTotal)),
            Sum(parts.Select(p => p.Votes.Null)),
            Sum(parts.Select(p => p.Votes.TechnicalNull)),
            Sum(parts.Select(p => p.Votes.AnnulledSections)),
            null,
            null,
            null,
            null);
        var keys = order.Count > 0 ? order : [.. parts[0].Candidates.Select(c => c.Key)];
        var candidateVotes = keys.Select(k => (Key: k, Votes: Sum(parts.Select(p => p.Candidates.FirstOrDefault(c => c.Key == k)?.Votes)))).ToList();
        var denominator = v.ToCandidates ?? Sum(candidateVotes.Select(c => c.Votes));
        var tallies = candidateVotes.Select(c => new CandidateTally(c.Key, c.Votes, ElectionMath.Share(c.Votes, denominator))).ToList();
        var leader = TerritorySnapshot.Leader(tallies);
        var ordered = tallies.Where(t => t.Percent is not null).OrderByDescending(t => t.Percent).ToList();
        var anyProgress = parts.Any(p => p.Progress == "p") ? "p" : parts.All(p => p.Progress == "f") ? "f" : parts.Any(p => p.Progress == "f") ? "p" : "n";
        return new TerritoryResultDto(
            scope,
            code,
            uf?.ToUpperInvariant(),
            name,
            null,
            false,
            [.. tallies.Select(t => new CandidateVotesDto(t.Key, t.Votes, t.Percent))],
            leader,
            TerritorySnapshot.Lead(tallies),
            ordered.Count >= 2 ? ordered[0].Percent - ordered[1].Percent : null,
            Sections(s),
            Electorate(e),
            Votes(v),
            LivePhases.ProgressName(anyProgress),
            parts.Max(p => p.TotalizedAt),
            parts.Max(p => p.GeneratedAt),
            parts.Max(p => p.IngestedAt),
            coverage,
            true);
    }

    /// <summary>"Onde estão os votos restantes?": eleitorado de seções não totalizadas e não apuradas por UF (EA14).</summary>
    public static IReadOnlyList<RemainingByUfDto> Remaining(LiveElectionState state)
    {
        var entries = state.NationalAccompaniment?.Entries.Where(e => e.ScopeType == "uf").ToList();
        if (entries is null || entries.Count == 0)
        {
            // Sem EA14: usa os arquivos de UF recebidos.
            entries = [.. state.States.Values.Select(s => new AccompanimentEntry("uf", s.Key.Code, s.Progress, s.TotalizedAt, s.Sections, s.Electorate))];
        }
        var bounds = entries.Select(e => (Entry: e, Bound: e.Electorate.InNotTotalized is null || e.Electorate.InNotCounted is null ? (long?)null : e.Electorate.InNotTotalized + e.Electorate.InNotCounted)).ToList();
        var total = bounds.All(b => b.Bound is not null) ? bounds.Sum(b => b.Bound!.Value) : (long?)null;
        return
        [
            .. bounds
                .OrderByDescending(b => b.Bound ?? -1)
                .ThenBy(b => b.Entry.Code, StringComparer.Ordinal)
                .Select(b => new RemainingByUfDto(
                    b.Entry.Code.ToUpperInvariant(),
                    Regions.NameOfUf(b.Entry.Code),
                    Regions.Of(b.Entry.Code),
                    b.Entry.Sections.NotTotalized,
                    b.Entry.Electorate.InNotTotalized,
                    b.Entry.Electorate.InNotCounted,
                    b.Bound,
                    total is > 0 ? ElectionMath.Share(b.Bound, total) : null,
                    b.Entry.Sections.TotalizedPct ?? ElectionMath.SectionsProgress(b.Entry.Sections.Totalized, b.Entry.Sections.Total),
                    b.Entry.TotalizedAt)),
        ];
    }

    private static TerritorialSummaryDto TerritorialSummary(LiveElectionState state, IReadOnlyList<string> ufs)
    {
        var leading = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var key in CandidateOrder(state)) leading[key] = 0;
        int tied = 0, without = 0;
        foreach (var uf in ufs)
        {
            if (!state.States.TryGetValue(uf, out var s) || !s.HasVotes)
            {
                without++;
                continue;
            }
            if (s.LeaderKey is { } leader) leading[leader] = leading.GetValueOrDefault(leader) + 1;
            else tied++;
        }

        var total = state.Context.BrazilianMunicipalityCount;
        var fresh = state.Municipalities.Values
            .Where(m => m.Uf is not null && m.Uf != "zz" && MunicipalityCoverage(state, m.Uf, m.Key.Code) == Coverage_Complete)
            .ToList();
        var complete = total > 0 && fresh.Count == total;
        Dictionary<string, int>? municipalLeading = null;
        if (complete)
        {
            municipalLeading = CandidateOrder(state).ToDictionary(k => k, _ => 0, StringComparer.Ordinal);
            foreach (var m in fresh)
                if (m.LeaderKey is { } k) municipalLeading[k] = municipalLeading.GetValueOrDefault(k) + 1;
        }
        return new TerritorialSummaryDto(
            leading,
            tied,
            without,
            new MunicipalityCoverageDto(total, fresh.Count, total > 0 ? Math.Round(fresh.Count * 100m / total, 2) : 0, complete, municipalLeading));
    }

    // ---------------------------------------------------------------- detalhe da UF, municípios, zonas, rankings

    public static StateDetailPayloadDto StateDetail(LiveElectionState state, string uf)
    {
        var order = CandidateOrder(state);
        var stateDto = State(state, uf);
        var capitalInfo = state.Context.Capital(uf);
        TerritoryResultDto? capital = null;
        TerritoryResultDto? interior = null;
        if (capitalInfo is not null)
        {
            capital = Municipality(state, capitalInfo.TseCode);
            if (state.States.TryGetValue(uf, out var whole) && state.Municipalities.TryGetValue(capitalInfo.TseCode, out var cap))
                interior = Interior(whole, cap, uf, order);
        }
        var timeline = state.StateTimelines.TryGetValue(uf, out var points) ? points.Select(PointDto).ToList() : [];
        return new StateDetailPayloadDto(stateDto, capital, interior, timeline, Comparison(state, "uf", uf));
    }

    /// <summary>Interior = UF − capital, em números absolutos. Arquivos de horários diferentes → cobertura parcial.</summary>
    public static TerritoryResultDto? Interior(TerritorySnapshot whole, TerritorySnapshot capital, string uf, IReadOnlyList<string> order)
    {
        static long? Minus(long? a, long? b) => a is null || b is null ? null : a - b;
        var votes = order.Select(k => new CandidateTally(
            k,
            Minus(whole.Candidates.FirstOrDefault(c => c.Key == k)?.Votes, capital.Candidates.FirstOrDefault(c => c.Key == k)?.Votes),
            null)).ToList();
        if (votes.Any(v => v.Votes < 0)) return null;
        var v = new VoteCounts(
            Minus(whole.Votes.Total, capital.Votes.Total),
            Minus(whole.Votes.ToCandidates, capital.Votes.ToCandidates),
            Minus(whole.Votes.Valid, capital.Votes.Valid),
            Minus(whole.Votes.Nominal, capital.Votes.Nominal),
            Minus(whole.Votes.Legend, capital.Votes.Legend),
            Minus(whole.Votes.Annulled, capital.Votes.Annulled),
            Minus(whole.Votes.AnnulledSubJudice, capital.Votes.AnnulledSubJudice),
            Minus(whole.Votes.NoCandidate, capital.Votes.NoCandidate),
            Minus(whole.Votes.Blank, capital.Votes.Blank),
            Minus(whole.Votes.NullTotal, capital.Votes.NullTotal),
            Minus(whole.Votes.Null, capital.Votes.Null),
            Minus(whole.Votes.TechnicalNull, capital.Votes.TechnicalNull),
            Minus(whole.Votes.AnnulledSections, capital.Votes.AnnulledSections),
            null,
            null,
            null,
            null);
        votes = [.. votes.Select(t => t with { Percent = ElectionMath.Share(t.Votes, v.ToCandidates) })];
        var s = new SectionCounts(
            Minus(whole.Sections.Total, capital.Sections.Total),
            Minus(whole.Sections.Totalized, capital.Sections.Totalized),
            Minus(whole.Sections.NotTotalized, capital.Sections.NotTotalized),
            Minus(whole.Sections.Installed, capital.Sections.Installed),
            Minus(whole.Sections.NotInstalled, capital.Sections.NotInstalled),
            Minus(whole.Sections.Counted, capital.Sections.Counted),
            Minus(whole.Sections.NotCounted, capital.Sections.NotCounted),
            null,
            null,
            null);
        var e = new ElectorateCounts(
            Minus(whole.Electorate.Total, capital.Electorate.Total),
            Minus(whole.Electorate.InTotalized, capital.Electorate.InTotalized),
            Minus(whole.Electorate.InNotTotalized, capital.Electorate.InNotTotalized),
            Minus(whole.Electorate.InInstalled, capital.Electorate.InInstalled),
            Minus(whole.Electorate.InNotInstalled, capital.Electorate.InNotInstalled),
            Minus(whole.Electorate.InCounted, capital.Electorate.InCounted),
            Minus(whole.Electorate.InNotCounted, capital.Electorate.InNotCounted),
            Minus(whole.Electorate.Turnout, capital.Electorate.Turnout),
            Minus(whole.Electorate.Abstention, capital.Electorate.Abstention),
            null,
            null,
            null,
            null);
        var aligned = whole.TotalizedAt is not null && capital.TotalizedAt is not null && Math.Abs((whole.TotalizedAt.Value - capital.TotalizedAt.Value).TotalMinutes) <= 2;
        var ordered = votes.Where(t => t.Percent is not null).OrderByDescending(t => t.Percent).ToList();
        return new TerritoryResultDto(
            "region",
            $"{uf.ToUpperInvariant()}-interior",
            uf.ToUpperInvariant(),
            "Interior (UF sem a capital)",
            Regions.Of(uf),
            false,
            [.. votes.Select(t => new CandidateVotesDto(t.Key, t.Votes, t.Percent))],
            TerritorySnapshot.Leader(votes),
            TerritorySnapshot.Lead(votes),
            ordered.Count >= 2 ? ordered[0].Percent - ordered[1].Percent : null,
            Sections(s),
            Electorate(e),
            Votes(v),
            LivePhases.ProgressName(whole.Progress),
            whole.TotalizedAt,
            whole.GeneratedAt,
            whole.IngestedAt,
            aligned ? Coverage_Complete : Coverage_Partial,
            true);
    }

    public static MunicipalitiesPayloadDto MunicipalityList(LiveElectionState state, string uf)
    {
        var ufInfo = state.Context.Ufs.FirstOrDefault(u => u.Uf == uf);
        if (ufInfo is null) return new MunicipalitiesPayloadDto(uf.ToUpperInvariant(), Regions.NameOfUf(uf), [], 0);
        var items = new List<MunicipalityListItemDto>(ufInfo.Municipalities.Count);
        var withData = 0;
        foreach (var m in ufInfo.Municipalities)
        {
            var entry = AccompanimentOf(state, uf, m.TseCode);
            var has = state.Municipalities.ContainsKey(m.TseCode);
            if (has) withData++;
            items.Add(new MunicipalityListItemDto(
                m.TseCode,
                m.IbgeCode,
                m.Name,
                uf.ToUpperInvariant(),
                m.Capital,
                MunicipalElectorate(state, uf, m.TseCode),
                entry?.Sections.TotalizedPct ?? ElectionMath.SectionsProgress(entry?.Sections.Totalized, entry?.Sections.Total),
                LivePhases.ProgressName(entry?.Progress),
                entry?.TotalizedAt,
                has ? Municipality(state, m.TseCode) : null));
        }
        return new MunicipalitiesPayloadDto(
            uf.ToUpperInvariant(),
            ufInfo.Name,
            items,
            ufInfo.Municipalities.Count == 0 ? 0 : Math.Round(withData * 100m / ufInfo.Municipalities.Count, 2));
    }

    public static MunicipalityDetailPayloadDto? MunicipalityDetail(LiveElectionState state, string code)
    {
        if (!state.Context.TryMunicipality(code, out _, out var municipality)) return null;
        return new MunicipalityDetailPayloadDto(Municipality(state, code), municipality.IbgeCode, municipality.Zones, Comparison(state, "mu", code));
    }

    public static ZonesPayloadDto? Zones(LiveElectionState state, string code)
    {
        if (!state.Context.TryMunicipality(code, out var uf, out var municipality)) return null;
        var order = CandidateOrder(state);
        var zones = municipality.Zones
            .Select(z => Territory(state.Zones.GetValueOrDefault($"{code}-{z}"), "zona", z, uf, $"Zona {z}", false, order, Coverage_Complete))
            .ToList();
        return new ZonesPayloadDto(new ZoneMunicipalityDto(code, municipality.Name, uf.ToUpperInvariant()), zones);
    }

    public static RankingPayloadDto Capitals(LiveElectionState state)
    {
        var capitals = state.Context.Ufs
            .Where(u => u.Uf != "zz")
            .Select(u => u.Municipalities.FirstOrDefault(m => m.Capital))
            .Where(m => m is not null)
            .Select(m => Municipality(state, m!.TseCode))
            .ToList();
        var have = capitals.Count(c => c.Available);
        return new RankingPayloadDto("capitals", "capitais (EA12)", capitals, capitals.Count == 0 ? 0 : Math.Round(have * 100m / capitals.Count, 2));
    }

    /// <summary>Maiores eleitorados segundo o EA15 (te por município). Sem EA15 recebido, a lista vem vazia.</summary>
    public static RankingPayloadDto Largest(LiveElectionState state, int limit)
    {
        var codes = LargestCodes(state, limit);
        var items = codes.Select(c => Municipality(state, c)).ToList();
        var have = items.Count(i => i.Available);
        return new RankingPayloadDto("largest", "eleitorado (EA20 do município; sem ele, EA15)", items, items.Count == 0 ? 0 : Math.Round(have * 100m / items.Count, 2));
    }

    /// <summary>Maiores eleitorados: EA20 municipal quando recebido (mais confiável), senão EA15.</summary>
    public static IReadOnlyList<string> LargestCodes(LiveElectionState state, int limit) =>
        [
            .. state.StateAccompaniment
                .Where(kv => kv.Key != "zz")
                .SelectMany(kv => kv.Value.Entries.Where(e => e.ScopeType == "mun").Select(e => (Code: e.Code, Electorate: MunicipalElectorate(state, kv.Key, e.Code))))
                .Where(x => x.Electorate is not null)
                .OrderByDescending(x => x.Electorate)
                .ThenBy(x => x.Code, StringComparer.Ordinal)
                .Take(Math.Clamp(limit, 1, 500))
                .Select(x => x.Code),
        ];

    // ---------------------------------------------------------------- linha do tempo

    public static TimelinePointDto PointDto(TimelinePoint p) => new(
        p.At,
        p.IngestedAt,
        p.SectionsPct,
        p.ElectoratePct,
        [.. p.Candidates.Select(c => new CandidateVotesDto(c.Key, c.Votes, c.Percent))],
        p.LeaderKey,
        p.LeadVotes,
        p.LeadPp);

    /// <summary>
    /// Teto de pontos por linha do tempo servida: horas de apuração com um snapshot por segundo não viram megabytes por
    /// visitante. O gráfico recebe um ponto por faixa de tempo (o último de cada faixa), mais o primeiro e o último.
    /// </summary>
    public const int MaxTimelinePoints = 480;

    public static LiveTimelinePayloadDto Timeline(LiveElectionState state, string scope, string code)
    {
        IReadOnlyList<TimelinePoint> points = scope == "uf" && state.StateTimelines.TryGetValue(code.ToLowerInvariant(), out var list)
            ? list
            : scope == "uf" ? [] : state.Timeline;
        return new LiveTimelinePayloadDto(
            scope,
            scope == "uf" ? code.ToUpperInvariant() : "br",
            [.. Downsample(points, MaxTimelinePoints).Select(PointDto)],
            scope == "uf" ? [] : [.. state.LeadChanges.Select(LeadChange)]);
    }

    public static LeadChangeDto LeadChange(LeadChangeRecord l) =>
        new(l.Id, l.At, l.DetectedAt, l.PreviousLeaderKey, l.NewLeaderKey, l.SectionsPct, [.. l.Votes.Select(v => new CandidateVotesDto(v.Key, v.Votes, v.Percent))], l.LeadVotes, l.SnapshotVersion);

    /// <summary>No máximo <paramref name="max"/> pontos, em faixas iguais de tempo (a ordem de versão é mantida).</summary>
    public static IReadOnlyList<TimelinePoint> Downsample(IReadOnlyList<TimelinePoint> points, int max)
    {
        if (points.Count <= max || max < 3) return points;
        static DateTimeOffset Time(TimelinePoint p) => p.At ?? p.IngestedAt;
        var first = points[0];
        var last = points[^1];
        var span = (Time(last) - Time(first)).Ticks;
        var buckets = max - 2;
        if (span <= 0)
        {
            // Sem eixo de tempo útil: amostragem uniforme por posição.
            var step = (points.Count - 1) / (double)(max - 1);
            return [.. Enumerable.Range(0, max).Select(i => points[(int)Math.Round(i * step)])];
        }
        var chosen = new TimelinePoint?[buckets];
        var index = 0;
        foreach (var p in points)
        {
            index++;
            if (index == 1 || index == points.Count) continue;
            var bucket = (int)Math.Clamp((Time(p) - Time(first)).Ticks * buckets / span, 0, buckets - 1);
            chosen[bucket] = p; // o último da faixa
        }
        var result = new List<TimelinePoint>(max) { first };
        result.AddRange(chosen.Where(p => p is not null).Select(p => p!).OrderBy(p => p.Version));
        result.Add(last);
        return result;
    }

    // ---------------------------------------------------------------- 1º turno

    public const string ComparisonNote =
        "Variação em relação ao 1º turno, em números oficiais. Não indica transferência de votos: não é possível saber para quem cada eleitor votou em cada turno.";

    public static FirstRoundComparisonDto? Comparison(LiveElectionState state, string scope, string code)
    {
        var baseline = state.FirstRound;
        var order = CandidateOrder(state);
        if (baseline is null) return null;
        TerritorySnapshot? first;
        TerritorySnapshot? second;
        string name;
        switch (scope)
        {
            case "br":
                first = baseline.National;
                second = state.National;
                name = "Brasil";
                break;
            case "uf":
                first = baseline.States.GetValueOrDefault(code.ToLowerInvariant());
                second = state.States.GetValueOrDefault(code.ToLowerInvariant());
                name = Regions.NameOfUf(code);
                break;
            case "mu":
                first = baseline.Municipalities.GetValueOrDefault(code);
                second = state.Municipalities.GetValueOrDefault(code);
                name = state.Context.TryMunicipality(code, out _, out var m) ? m.Name : code;
                break;
            case "region":
                {
                    var regionCode = code.ToUpperInvariant();
                    var members = Regions.ByUf.Where(kv => kv.Value == regionCode).Select(kv => kv.Key).ToList();
                    if (members.Count == 0) return null;
                    var r1 = members.Select(uf => baseline.States.GetValueOrDefault(uf)).ToList();
                    var r2 = members.Select(uf => state.States.GetValueOrDefault(uf)).ToList();
                    name = Regions.All.First(r => r.Code == regionCode).Name;
                    if (r1.Any(s => s is null)) return Unavailable(baseline, scope, regionCode, name);
                    var firstParts = r1.Select(s => s!).ToList();
                    var firstAgg = Aggregate("region", regionCode, null, name, firstParts, [.. firstParts[0].Candidates.Select(c => c.Key)], Coverage_Complete);
                    var secondAgg = r2.All(s => s is not null) ? Aggregate("region", regionCode, null, name, [.. r2.Select(s => s!)], order, Coverage_Complete) : null;
                    return CompareDtos(baseline, scope, regionCode, name, firstAgg, secondAgg, order, firstParts, state);
                }
            default:
                return null;
        }
        if (first is null) return Unavailable(baseline, scope, code, name);
        var firstDto = Territory(first, scope, code, null, name, false, [.. first.Candidates.Select(c => c.Key)], Coverage_Complete);
        var secondDto = second is null ? null : Territory(second, scope, code, null, name, false, order, Coverage_Complete);
        return CompareDtos(baseline, scope, code, name, firstDto, secondDto, order, [first], state);
    }

    private static FirstRoundComparisonDto Unavailable(FirstRoundBaseline baseline, string scope, string code, string name) =>
        new(false, baseline.ElectionCode, scope, code, name, [], [], null, "Resultado do 1º turno desta abrangência ainda não carregado.");

    private static FirstRoundComparisonDto CompareDtos(
        FirstRoundBaseline baseline,
        string scope,
        string code,
        string name,
        TerritoryResultDto first,
        TerritoryResultDto? second,
        IReadOnlyList<string> order,
        IReadOnlyList<TerritorySnapshot> firstSnapshots,
        LiveElectionState state)
    {
        var firstProfiles = firstSnapshots.SelectMany(s => s.Profiles).GroupBy(p => p.Key).Select(g => g.First()).ToList();
        var candidates = new List<RoundComparisonCandidateDto>();
        foreach (var key in order)
        {
            var profile = state.National?.Profiles.FirstOrDefault(p => p.Key == key);
            string? matchedBy = null;
            var firstProfile = firstProfiles.FirstOrDefault(p => p.Key == key);
            if (firstProfile is not null) matchedBy = "sqcand";
            else if (profile is not null)
            {
                firstProfile = firstProfiles.FirstOrDefault(p => p.Number == profile.Number);
                if (firstProfile is not null) matchedBy = "number";
            }
            var r1 = firstProfile is null ? null : first.Candidates.FirstOrDefault(c => c.Key == firstProfile.Key);
            var r2 = second?.Candidates.FirstOrDefault(c => c.Key == key);
            candidates.Add(new RoundComparisonCandidateDto(
                key,
                matchedBy,
                r1 is null ? null : new FirstRoundSideDto(r1.Votes, r1.Pct, firstProfile?.Position),
                new SecondRoundSideDto(r2?.Votes, r2?.Pct),
                r1?.Votes is not null && r2?.Votes is not null ? r2.Votes - r1.Votes : null,
                r1?.Pct is not null && r2?.Pct is not null ? r2.Pct - r1.Pct : null));
        }

        TurnoutComparisonDto Metric(string metric, long? c1, decimal? p1, long? c2, decimal? p2) =>
            new(metric, new RoundValueDto(c1, p1), new RoundValueDto(c2, p2), c1 is not null && c2 is not null ? c2 - c1 : null, p1 is not null && p2 is not null ? p2 - p1 : null);

        var turnout = new List<TurnoutComparisonDto>
        {
            Metric("turnout", first.Electorate.Turnout, first.Electorate.TurnoutPct, second?.Electorate.Turnout, second?.Electorate.TurnoutPct),
            Metric("abstention", first.Electorate.Abstention, first.Electorate.AbstentionPct, second?.Electorate.Abstention, second?.Electorate.AbstentionPct),
            Metric("valid", first.Votes.Valid, first.Votes.ValidPct, second?.Votes.Valid, second?.Votes.ValidPct),
            Metric("blank", first.Votes.Blank, first.Votes.BlankPct, second?.Votes.Blank, second?.Votes.BlankPct),
            Metric("null", first.Votes.NullTotal, first.Votes.NullTotalPct, second?.Votes.NullTotal, second?.Votes.NullTotalPct),
        };
        var progress = second?.Sections.TotalizedPct;
        var note = progress is < 100m
            ? $"{ComparisonNote} O 2º turno ainda está em totalização ({progress.Value:0.##}% das seções); a comparação é parcial."
            : ComparisonNote;
        return new FirstRoundComparisonDto(true, baseline.ElectionCode, scope, code, name, candidates, turnout, progress, note);
    }

    // ---------------------------------------------------------------- saúde

    public static LiveHealthPublicDto Health(LiveElectionState state, DateTimeOffset now, long tseRequests = 0)
    {
        var status = state.Source.Failing ? (state.National is null ? "down" : "degraded") : state.Source.Stale ? "degraded" : "healthy";
        return new LiveHealthPublicDto(
            status,
            state.Context.Mode,
            state.Phase.ToString(),
            state.Source.LastSuccessAt,
            state.National?.IngestedAt,
            state.National is null ? null : Math.Max(0, (now - state.National.IngestedAt).TotalSeconds),
            state.Source.Stale,
            tseRequests);
    }
}
