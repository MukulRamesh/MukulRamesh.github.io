const totalTimeAudio = 1 // seconds of audio


// var audioButton = document.getElementById("audioButton");

// addClickListenerToElem(audioButton, tone)

function testtone()
{
    console.log(scale(3))
}

function scale(semitones, note='A3')
{
    if (semitones > 16)
    {
        semitones = 16
    }

    let eachNoteTime = totalTimeAudio / semitones

    var vol = new Tone.Volume(-12);
    const synth = new Tone.Synth();

    synth.chain(vol, Tone.Master)

    const now = Tone.now()

    for (let i = 0; i < semitones; i++)
    {
        newNote = Tone.Frequency(note).transpose(i); // "C5"
        synth.triggerAttackRelease(newNote, "8n", (now + (i * eachNoteTime)));
    }

    return newNote.toNote()
}


