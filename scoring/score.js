let streakElem = document.getElementById("streakText")
let scoreElem = document.getElementById("scoreText")
let curStreak = 0
let highestStreak = 0
let curScore = 0
let scoreIncreaseAmount = 3
let streakMultiplier = 3
let totalScoreUpdateTime = 1 // in sec (it is nice when this equals totalTimeAudio, defined in pointsAudio.js)
var scoreUpdateDelay = NaN


function clearScore()
{
    curScore = 0
    breakStreak()
    scoreElem.textContent = "Score: 0"
}

function increaseScore()
{
    curScore += (curStreak * streakMultiplier) + scoreIncreaseAmount
    scoreDiff = curScore - readScore()


    scale(scoreDiff)
    scoreUpdateDelay = (totalScoreUpdateTime * 1000) / scoreDiff //the ms that the score takes to increase by 1
    updateScore()
}

function updateScore()
{
    if (scoreDiff > 0)
    {
        //TODO: play a pleasing tone that increases in pitch slightly with each consecutive score update
        newScore = "Score: " + (readScore() + 1)
        scoreElem.textContent = newScore
        scoreDiff--
        setTimeout(updateScore, scoreUpdateDelay)
    }
}

function increaseStreak()
{
    curStreak++

    triggerParticles()
    increaseDensity()

    if (curStreak > highestStreak)
    {
        highestStreak = curStreak
    }

    streakElem.textContent = "Streak: " + curStreak
}

function breakStreak()
{
    curStreak = 0
    resetDensity()

    streakElem.textContent = "Streak: " + curStreak
}

function readScore()
{
    return parseInt(scoreElem.textContent.slice(7)) //7 is the length of "Score: "
}
