# Build stage
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /app
COPY . .
RUN dotnet publish src/RepBrasil.API/RepBrasil.API.csproj -c Release -o /publish

# Runtime stage — lean ASP.NET Core runtime (not SDK)
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /publish .

# Dump startup context to stdout so Railway logs capture it, then launch the app.
# ASPNETCORE_URLS is set so the app binds to Railway's injected PORT (fallback 8080).
CMD echo "=== RepBrasil API starting ===" \
    && echo "PORT=${PORT}" \
    && echo "ASPNETCORE_ENVIRONMENT=${ASPNETCORE_ENVIRONMENT}" \
    && ls /app/RepBrasil.API.dll \
    && ASPNETCORE_URLS="http://+:${PORT:-8080}" dotnet RepBrasil.API.dll
