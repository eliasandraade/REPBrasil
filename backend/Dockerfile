# Build stage
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /app
COPY . .
RUN dotnet publish src/RepBrasil.API/RepBrasil.API.csproj -c Release -o /publish

# Runtime stage — lean ASP.NET Core runtime (not SDK)
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /publish .

# CMD is overridden by railway.toml startCommand in production.
# Kept here as a sensible fallback for local docker run.
CMD ["dotnet", "RepBrasil.API.dll"]
