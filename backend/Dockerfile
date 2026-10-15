# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY backend/src/Hamyon.Domain/Hamyon.Domain.csproj backend/src/Hamyon.Domain/
COPY backend/src/Hamyon.Api/Hamyon.Api.csproj backend/src/Hamyon.Api/
RUN dotnet restore backend/src/Hamyon.Api/Hamyon.Api.csproj
COPY backend/src backend/src
RUN dotnet publish backend/src/Hamyon.Api/Hamyon.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin hamyon \
 && mkdir -p /data/uploads && chown -R hamyon /data
COPY --from=build /app .
USER hamyon
ENV ASPNETCORE_URLS=http://+:8080 \
    Storage__Path=/data/uploads
EXPOSE 8080
ENTRYPOINT ["dotnet", "Hamyon.Api.dll"]
