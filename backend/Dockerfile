FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /app
COPY . .
RUN dotnet publish src/RepBrasil.API/RepBrasil.API.csproj -c Release -o /publish

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /publish .
USER $APP_UID
ENTRYPOINT ["/bin/sh", "-c", "echo '[DOCKER] Starting container' && which dotnet && test -f /app/RepBrasil.API.dll && echo '[DOCKER] Launching app on port '${PORT:-8080} && ASPNETCORE_HTTP_PORTS=${PORT:-8080} dotnet /app/RepBrasil.API.dll"]
