/*
 * Particle → layer-buffer renderer, ported from opc.js/virtual-opc.js
 * mapParticles(). Writes additively-summed particle light into a Float32
 * layer buffer instead of straight into the OPC client, so particle
 * effects can participate in layer blending.
 *
 * Particles: { point: [x, y, z], intensity, falloff, color: [r, g, b] }.
 * A particle with an empty point [] contributes at zero distance
 * everywhere (the "ambient" particle trick from the old shader), which
 * the (diff || 0) fallback reproduces.
 */

function defaultFalloff(distanceSq, intensity, falloff) {
    return intensity / (1 + falloff * distanceSq);
}

function renderParticles(out, particles, count, modelX, modelZ, numPixels, intensityFn) {
    var fn = intensityFn || defaultFalloff;

    for (var i = 0; i < numPixels; i++) {
        var px = modelX[i];
        var pz = modelZ[i];
        var r = 0, g = 0, b = 0;

        for (var pi = 0; pi < count; pi++) {
            var particle = particles[pi];
            var dx = (px - particle.point[0]) || 0;
            var dy = (0 - particle.point[1]) || 0;
            var dz = (pz - particle.point[2]) || 0;
            var dist2 = dx * dx + dy * dy + dz * dz;

            var intensity = fn(dist2, particle.intensity, particle.falloff);
            r += particle.color[0] * intensity;
            g += particle.color[1] * intensity;
            b += particle.color[2] * intensity;
        }

        out[i * 3] = r;
        out[i * 3 + 1] = g;
        out[i * 3 + 2] = b;
    }
}

module.exports = { renderParticles, defaultFalloff };
