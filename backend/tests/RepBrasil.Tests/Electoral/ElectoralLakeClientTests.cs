using System.Net;
using System.Text;
using RepBrasil.Application.Electoral;
using RepBrasil.Infrastructure.Repositories;

namespace RepBrasil.Tests.Electoral;

public class ElectoralLakeClientTests
{
    [Fact]
    public async Task ResultVotesAsync_posts_scope_with_content_length_and_maps_vote_rows()
    {
        string? body = null;
        var handler = new StubHandler(async request =>
        {
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("http://lake.test/v1/result-votes", request.RequestUri!.ToString());
            Assert.Equal("application/json", request.Content!.Headers.ContentType!.MediaType);
            Assert.True(request.Content.Headers.ContentLength > 0);
            body = await request.Content.ReadAsStringAsync();
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """
                    [{"voteKind":"candidate","typeCode":1,"typeDescription":"Nominal","number":13,"name":"CANDIDATO","partyNumber":13,"partyAcronym":"ABC","partyName":"PARTIDO ABC","votes":42,"candidacyId":null,"tseCandidateId":123,"personId":null,"politicianId":null}]
                    """,
                    Encoding.UTF8,
                    "application/json"),
            };
        });
        using var http = new HttpClient(handler) { BaseAddress = new Uri("http://lake.test") };
        var client = new ElectoralLakeClient(http);

        var rows = await client.ResultVotesAsync(77, "ce", CancellationToken.None);

        Assert.Contains("\"resultId\":77", body);
        Assert.Contains("\"uf\":\"CE\"", body);
        var row = Assert.Single(rows);
        Assert.Equal("candidate", row.VoteKind);
        Assert.Equal(13, row.Number);
        Assert.Equal(42, row.Votes);
        Assert.Equal(123, row.TseCandidateId);
    }

    [Fact]
    public async Task Xray_queries_post_worker_contract_and_map_cold_section_values()
    {
        var candidacyId = Guid.Parse("00000000-0000-0000-0000-000000000013");
        var bodies = new Dictionary<string, string>();
        var handler = new StubHandler(async request =>
        {
            var path = request.RequestUri!.AbsolutePath;
            Assert.Equal(HttpMethod.Post, request.Method);
            Assert.Equal("application/json", request.Content!.Headers.ContentType!.MediaType);
            Assert.True(request.Content.Headers.ContentLength > 0);
            bodies[path] = await request.Content.ReadAsStringAsync();
            var json = path switch
            {
                "/v1/valid-votes" => "[{\"resultId\":7001,\"validVotes\":311}]",
                "/v1/candidacy-votes" => $"[{{\"resultId\":7001,\"candidacyId\":\"{candidacyId}\",\"votes\":127}}]",
                _ => throw new InvalidOperationException(path),
            };
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            };
        });
        using var http = new HttpClient(handler) { BaseAddress = new Uri("http://lake.test") };
        var client = new ElectoralLakeClient(http);

        var valid = await client.ValidVotesByResultAsync(2024, 1, "ce", "12345", [11], 50, CancellationToken.None);
        var votes = await client.CandidacyVotesByResultAsync(
            [candidacyId], [new ElectionOffice(2024, 1, 11)], "ce", "12345", 50, CancellationToken.None);

        Assert.Equal(311, valid[7001]);
        var row = Assert.Single(votes);
        Assert.Equal((7001L, candidacyId, 127L), (row.ResultId, row.CandidacyId, row.Votes));
        Assert.Contains("\"officeCodes\":[11]", bodies["/v1/valid-votes"]);
        Assert.Contains("\"municipalityTseCode\":\"12345\"", bodies["/v1/valid-votes"]);
        Assert.Contains("\"scopes\":[{\"year\":2024,\"round\":1,\"officeCode\":11}]", bodies["/v1/candidacy-votes"]);
    }

    [Fact]
    public async Task ResultVotesAsync_throws_when_worker_fails()
    {
        var handler = new StubHandler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadRequest)
        {
            Content = new StringContent("{\"error\":\"invalid_request\"}", Encoding.UTF8, "application/json"),
        }));
        using var http = new HttpClient(handler) { BaseAddress = new Uri("http://lake.test") };
        var client = new ElectoralLakeClient(http);

        var error = await Assert.ThrowsAsync<ElectoralUnavailableException>(
            () => client.ResultVotesAsync(99, "CE", CancellationToken.None));

        Assert.Equal(HttpStatusCode.BadRequest, Assert.IsType<HttpRequestException>(error.InnerException).StatusCode);
        Assert.Contains("result 99", error.Message);
        Assert.DoesNotContain("invalid_request", error.Message); // corpo interno do worker nunca vaza
    }

    [Fact]
    public async Task Unreachable_or_slow_worker_is_unavailable_not_empty()
    {
        var down = new StubHandler(_ => throw new HttpRequestException("connection refused"));
        using var downHttp = new HttpClient(down) { BaseAddress = new Uri("http://lake.test") };
        await Assert.ThrowsAsync<ElectoralUnavailableException>(
            () => new ElectoralLakeClient(downHttp).ResultVotesAsync(1, "CE", CancellationToken.None));

        var slow = new StubHandler(_ => throw new TaskCanceledException("timeout"));
        using var slowHttp = new HttpClient(slow) { BaseAddress = new Uri("http://lake.test") };
        await Assert.ThrowsAsync<ElectoralUnavailableException>(
            () => new ElectoralLakeClient(slowHttp).ResultVotesAsync(1, "CE", CancellationToken.None));
    }

    [Fact]
    public async Task Configured_token_is_sent_as_bearer_and_absent_token_sends_no_header()
    {
        string? seen = "unset";
        var handler = new StubHandler(request =>
        {
            seen = request.Headers.Authorization?.ToString();
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[]", Encoding.UTF8, "application/json"),
            });
        });

        using var withToken = new HttpClient(handler) { BaseAddress = new Uri("http://lake.test") };
        ElectoralLakeClient.ConfigureAuthorization(withToken, " lake-secret ");
        await new ElectoralLakeClient(withToken).ResultVotesAsync(1, "CE", CancellationToken.None);
        Assert.Equal("Bearer lake-secret", seen);

        using var withoutToken = new HttpClient(handler) { BaseAddress = new Uri("http://lake.test") };
        ElectoralLakeClient.ConfigureAuthorization(withoutToken, "  ");
        await new ElectoralLakeClient(withoutToken).ResultVotesAsync(1, "CE", CancellationToken.None);
        Assert.Null(seen);
    }

    private sealed class StubHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            send(request);
    }
}
