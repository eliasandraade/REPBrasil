using System.Net;
using System.Text;
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
    public async Task ResultVotesAsync_throws_when_worker_fails()
    {
        var handler = new StubHandler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadRequest)
        {
            Content = new StringContent("{\"error\":\"invalid_request\"}", Encoding.UTF8, "application/json"),
        }));
        using var http = new HttpClient(handler) { BaseAddress = new Uri("http://lake.test") };
        var client = new ElectoralLakeClient(http);

        var error = await Assert.ThrowsAsync<HttpRequestException>(
            () => client.ResultVotesAsync(99, "CE", CancellationToken.None));

        Assert.Equal(HttpStatusCode.BadRequest, error.StatusCode);
        Assert.Contains("result 99", error.Message);
    }

    private sealed class StubHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            send(request);
    }
}
