# Build stage
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /app
COPY . .
RUN dotnet publish src/RepBrasil.API/RepBrasil.API.csproj -c Release -o /publish

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /publish .

# Verify DLL exists and dotnet is available, then start the app.
ENTRYPOINT ["/bin/sh", "-c", "echo '[DOCKER] Starting container' && which dotnet && ls /app/RepBrasil.API.dll && echo '[DOCKER] Launching app on port '${PORT:-8080} && ASPNETCORE_URLS=http://+:${PORT:-8080} dotnet /app/RepBrasil.API.dll"]
