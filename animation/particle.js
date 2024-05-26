// All options can be found here: https://particles.js.org/docs/interfaces/Options_Interfaces_IOptions.IOptions.html
// The slim version doesn't have the following plugins:
// Absorbers, Emitters, PolygonMask, Interactivity Trail
const options = {
    // background: {
    //     color: "#000", // the canvas background color
    // },
    particles: {

        interactivity: {

        },

        move: {
            enable: true, // this makes particles move
            speed: { min: 30, max: 40 }, // this is the speed of the particles
            direction: "top",
            angle: { offset: 0, value: 0 },
            outModes: {
                top: "destroy"
            },

        },

        opacity: {
            value: { min: 0.5, max: .9 }, // this sets the opacity of the particles
        },
        size: {
            value: { min: 30, max: 60 }, // this sets the size of the particles
        },
        number: {
            value: 4,
            density: {

            },
        },
        shape: {
            close: true,
            fill: true,
            type: "character",

            options: {
                "character": {
                    "value": "🔥", // the text to use as particles, any string is valid, for escaping unicode char use the `\uXXXX` syntax
                }
            },
        },
        wobble: {
            enable: true,
            distance: 60,
            speed: {
                angle: 50,
                move: 20
            }
        }
    },
};



DEFAULT_PARTICLE_DENSITY = 4
PARTICLE_INCREMENT_AMOUNT = 20

function resetDensity()
{
    options.particles.number.value = DEFAULT_PARTICLE_DENSITY
}

function increaseDensity()
{
    options.particles.number.value += PARTICLE_INCREMENT_AMOUNT
}

function triggerParticles()
{
    // tsParticles.load has two parameters, the first one is the id of the container, the second one is an object with the options
    tsParticles.load("tsparticles", options);
}