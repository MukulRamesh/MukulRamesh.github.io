const totalTimeAudio = 1 // seconds of audio


// var audioButton = document.getElementById("audioButton");

// addClickListenerToElem(audioButton, tone)

function testtone()
{
    console.log(scale(3))
}

function scale(semitones, note='A3')
{
    let eachNoteTime = totalTimeAudio / semitones
    const synth = new Tone.Synth().toDestination();
    const now = Tone.now()

    for (let i = 0; i < semitones; i++)
    {
        newNote = Tone.Frequency(note).transpose(i); // "C5"
        synth.triggerAttackRelease(newNote, "8n", (now + (i * eachNoteTime)));
    }

    return newNote.toNote()
}


