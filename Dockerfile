# The mobile aggregation alone: a static binary on Alpine (the health check runs through /bin/sh and wget).
FROM golang:1.27.2-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /infra-bff-mobile .

FROM alpine:3.24.2
COPY --from=build /infra-bff-mobile /infra-bff-mobile
EXPOSE 8500
ENTRYPOINT ["/infra-bff-mobile"]
