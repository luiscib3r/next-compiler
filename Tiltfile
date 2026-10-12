# Kubernetes environment for comparing the two runtimes with the same
# architecture: 8 replicas of the Bun binary and 8 of Node.js, both with the
# shared Redis cache, plus Jaeger for the OpenTelemetry work ahead.
#
#   tilt up
#
# Everything lives in the `next-compiler` namespace. Port forwards reach one
# pod only; load tests must run inside the cluster and go through the
# Services (`next-bun`, `next-node`), which balance across replicas: see the
# `loadtest` resource at the end.

allow_k8s_contexts(['orbstack', 'docker-desktop', 'kind-kind', 'minikube'])

# Images. On OrbStack and Docker Desktop the cluster shares the local Docker
# daemon, so Tilt builds and the pods use the images without a registry.
# Changes to the load tests, the manifests or docs do not rebuild anything.
not_the_app = ['loadtest', 'k8s', 'Tiltfile', 'docker-compose.yml', 'README.md']

docker_build(
    'next-compiler',
    context='.',
    dockerfile='Dockerfile',
    ignore=not_the_app,
)

docker_build(
    'next-node-redis',
    context='.',
    dockerfile='Dockerfile.node',
    build_args={'BUILD_CACHE': 'redis'},
    ignore=not_the_app,
)

k8s_yaml([
    'k8s/namespace.yaml',
    'k8s/redis.yaml',
    'k8s/jaeger.yaml',
    'k8s/next-bun.yaml',
    'k8s/next-node.yaml',
])

k8s_resource('redis', labels=['infra'], port_forwards=['16379:6379'])
k8s_resource('jaeger', labels=['infra'], port_forwards=['16686:16686'])
k8s_resource(
    'next-bun',
    labels=['apps'],
    resource_deps=['redis'],
    port_forwards=['18080:8080'],
)
k8s_resource(
    'next-node',
    labels=['apps'],
    resource_deps=['redis'],
    port_forwards=['18081:8080'],
)

# Load tests. k6 runs as a Job inside the cluster (`k8s/loadtest/k6-job.yaml`)
# against the Services. Its script reaches the Job through this ConfigMap,
# rebuilt whenever the script changes.
watch_file('loadtest/k6/script.js')
k8s_yaml(local(
    'kubectl create configmap k6-script --namespace next-compiler '
    + '--from-file=script.js=loadtest/k6/script.js --dry-run=client -o yaml',
    quiet=True,
))
k8s_resource(
    new_name='k6-script',
    objects=['k6-script:configmap'],
    labels=['loadtest'],
)

# The whole suite, both variants, on demand: a button in the Tilt UI (or
# `tilt trigger loadtest`). It never runs on `tilt up`. Results land in
# `loadtest/results/k8s-*.{json,md}`.
local_resource(
    'loadtest',
    cmd='bun loadtest/k8s.ts --repeat 2',
    auto_init=False,
    trigger_mode=TRIGGER_MODE_MANUAL,
    resource_deps=['next-bun', 'next-node', 'k6-script'],
    labels=['loadtest'],
)
